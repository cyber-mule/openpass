<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useSecretStore } from '@/stores/secrets';
import { useAutoBackup } from '@/composables/useAutoBackup';
import { useAuthStore } from '@/stores/auth';
import { showToast } from '@/utils/ui';
import CryptoUtils from '@/utils/crypto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Upload, Download, AlertTriangle, Check, X, Loader2 } from 'lucide-vue-next';

const secretStore = useSecretStore();
const autoBackup = useAutoBackup();
const authStore = useAuthStore();

// 导出相关
const exportPassword = ref('');
const isExporting = ref(false);
const exportProgress = ref('');

// 导入相关
const importFile = ref<HTMLInputElement | null>(null);
const isReadingFile = ref(false);
const pendingImportData = ref<any>(null);
const isEncryptedBackup = ref(false);
const importPassword = ref('');
const importPasswordError = ref('');
const showImportModal = ref(false);
const isImporting = ref(false);
const importProgress = ref(0);
const importAction = ref<'merge' | 'overwrite'>('merge');

// 备份信息
const backupInfo = computed(() => {
  if (!pendingImportData.value) return null;
  return {
    version: pendingImportData.value.appVersion || '未知',
    exportTime: pendingImportData.value.exportTime
      ? new Date(pendingImportData.value.exportTime).toLocaleString('zh-CN')
      : '-',
    count: pendingImportData.value.count || pendingImportData.value.secrets?.length || 0,
    encrypted: isEncryptedBackup.value
  };
});

// 加密设置
const enableBackupEncryption = ref(false);
const useMasterPasswordForBackup = ref(true);

onMounted(async () => {
  await autoBackup.loadSettings();

  // 加载加密设置
  const result = await chrome.storage.local.get([
    'enableBackupEncryption',
    'useMasterPasswordForBackup'
  ]);
  enableBackupEncryption.value = result.enableBackupEncryption || false;
  useMasterPasswordForBackup.value = result.useMasterPasswordForBackup !== false;
});

// 导出备份
async function handleExport() {
  if (secretStore.secrets.length === 0) {
    showToast('没有可导出的密钥', 'warning');
    return;
  }

  isExporting.value = true;
  exportProgress.value = '准备导出...';

  try {
    let password = exportPassword.value || undefined;

    // 如果启用了加密设置且使用主密码，且有 sessionKey
    if (enableBackupEncryption.value && useMasterPasswordForBackup.value && !password && authStore.sessionKey) {
      password = authStore.sessionKey;
    }

    // 如果设置了加密但没有密码，提示用户
    if (enableBackupEncryption.value && !password) {
      showToast('加密备份需要密码，请在下方输入密码', 'warning');
      isExporting.value = false;
      exportProgress.value = '';
      return;
    }

    exportProgress.value = '正在加密数据...';
    const backupData = await autoBackup.createBackup(secretStore.secrets, { password });

    exportProgress.value = '正在生成文件...';
    const json = JSON.stringify(backupData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const suffix = password ? '-encrypted' : '';
    const filename = `openpass-backup-${new Date().toISOString().split('T')[0]}${suffix}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    showToast(`已导出 ${secretStore.secrets.length} 个密钥${password ? '（已加密）' : ''}`, 'success');
    exportPassword.value = '';
    exportProgress.value = '';
  } catch (error: any) {
    showToast('导出失败: ' + error.message, 'error');
    exportProgress.value = '';
  } finally {
    isExporting.value = false;
  }
}

// 选择文件导入
async function handleFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  isReadingFile.value = true;
  showToast('正在读取备份文件...', 'info');

  try {
    // 等待一帧确保 UI 更新
    await new Promise(resolve => requestAnimationFrame(resolve));

    const content = await file.text();
    const data = JSON.parse(content);

    // 验证备份格式
    const validation = validateBackup(data);
    if (!validation.valid) {
      showToast(validation.error || '无效的备份文件格式', 'error');
      isReadingFile.value = false;
      return;
    }

    pendingImportData.value = validation.data;
    isEncryptedBackup.value = validation.encrypted || false;

    // 重置密码输入
    importPassword.value = '';
    importPasswordError.value = '';
    importAction.value = 'merge';

    // 显示导入对话框
    showImportModal.value = true;
    isReadingFile.value = false;

  } catch (error: any) {
    showToast('读取文件失败: ' + error.message, 'error');
    isReadingFile.value = false;
  }

  // 清空文件输入
  if (importFile.value) {
    importFile.value.value = '';
  }
}

// 验证备份数据格式
function validateBackup(data: any): { valid: boolean; error?: string; data?: any; encrypted?: boolean } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: '无效的备份文件' };
  }

  // 检查格式标识
  if (data.format === 'openpass-backup') {
    if (typeof data.formatVersion !== 'number') {
      return { valid: false, error: '缺少格式版本号' };
    }

    // 检查是否加密
    if (data.encrypted && data.encryptedData) {
      return { valid: true, data, encrypted: true };
    }

    // 明文备份，验证 secrets
    if (!Array.isArray(data.secrets)) {
      return { valid: false, error: '缺少密钥数据' };
    }
  } else if (Array.isArray(data)) {
    // 最简格式：直接是数组
    data = {
      format: 'openpass-backup',
      formatVersion: 0,
      appVersion: '0.0.0',
      exportTime: null,
      count: data.length,
      secrets: data
    };
  } else if (Array.isArray(data.secrets)) {
    // 兼容其他包含 secrets 字段的格式
    data = {
      format: 'openpass-backup',
      formatVersion: 0,
      appVersion: data.appVersion || '0.0.0',
      exportTime: data.exportTime || null,
      count: data.secrets.length,
      secrets: data.secrets
    };
  } else {
    return { valid: false, error: '无法识别的备份格式' };
  }

  return { valid: true, data, encrypted: false };
}

// 解密加密备份（点击确认导入时）
async function decryptAndImport() {
  if (!importPassword.value) {
    importPasswordError.value = '请输入解密密码';
    return;
  }

  isImporting.value = true;
  importProgress.value = 0;
  importPasswordError.value = '';

  try {
    importProgress.value = 30;
    const decrypted = await CryptoUtils.decrypt(
      pendingImportData.value.encryptedData,
      importPassword.value
    );

    importProgress.value = 50;
    pendingImportData.value.secrets = JSON.parse(decrypted);
    pendingImportData.value.encrypted = false;

    importProgress.value = 70;
    await performImport();

  } catch (error: any) {
    importPasswordError.value = '解密失败，请检查密码是否正确';
    isImporting.value = false;
    importProgress.value = 0;
  }
}

// 执行导入
async function performImport() {
  if (!pendingImportData.value?.secrets) {
    showToast('备份数据无效', 'error');
    resetImport();
    return;
  }

  isImporting.value = true;
  const secretsToImport = pendingImportData.value.secrets;
  const total = secretsToImport.length;

  try {
    let addedCount = 0;
    let skippedCount = 0;

    if (importAction.value === 'overwrite') {
      // 覆盖模式：先清空再导入
      secretStore.secrets = [];
      for (let i = 0; i < secretsToImport.length; i++) {
        secretStore.secrets.push({
          ...secretsToImport[i],
          id: secretsToImport[i].id || crypto.randomUUID(),
          importedAt: new Date().toISOString()
        });
        importProgress.value = 70 + Math.floor((i / total) * 25);
        addedCount++;
      }
    } else {
      // 合并模式：跳过重复
      for (let i = 0; i < secretsToImport.length; i++) {
        const secret = secretsToImport[i];
        const exists = secretStore.secrets.some(
          s => s.site.toLowerCase() === secret.site?.toLowerCase()
        );

        if (!exists) {
          secretStore.secrets.push({
            ...secret,
            id: secret.id || crypto.randomUUID(),
            importedAt: new Date().toISOString()
          });
          addedCount++;
        } else {
          skippedCount++;
        }
        importProgress.value = 70 + Math.floor((i / total) * 25);
      }
    }

    importProgress.value = 95;
    await secretStore.saveSecrets();

    importProgress.value = 100;

    // 显示结果
    if (importAction.value === 'overwrite') {
      showToast(`已导入 ${addedCount} 个密钥（覆盖模式）`, 'success');
    } else {
      if (skippedCount > 0) {
        showToast(`已导入 ${addedCount} 个，跳过 ${skippedCount} 个重复`, 'success');
      } else {
        showToast(`已导入 ${addedCount} 个密钥`, 'success');
      }
    }

    resetImport();

  } catch (error: any) {
    showToast('导入失败: ' + error.message, 'error');
    isImporting.value = false;
    importProgress.value = 0;
  }
}

// 确认导入
async function confirmImport() {
  if (isEncryptedBackup.value) {
    await decryptAndImport();
  } else {
    await performImport();
  }
}

// 重置导入状态
function resetImport() {
  showImportModal.value = false;
  pendingImportData.value = null;
  isEncryptedBackup.value = false;
  importPassword.value = '';
  importPasswordError.value = '';
  importAction.value = 'merge';
  isImporting.value = false;
  importProgress.value = 0;
}

// 取消导入
function cancelImport() {
  resetImport();
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold text-foreground">备份恢复</h1>

    <!-- 导出备份 -->
    <Card>
      <CardHeader>
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
            <Download class="w-6 h-6 text-green-600" />
          </div>
          <div>
            <CardTitle>导出备份</CardTitle>
            <CardDescription>将所有密钥导出为 JSON 文件，保存到本地</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- 导出进度 -->
        <div v-if="isExporting" class="flex items-center gap-3 p-3 bg-muted rounded-lg">
          <Loader2 class="w-4 h-4 animate-spin text-primary" />
          <span class="text-sm">{{ exportProgress }}</span>
        </div>

        <div class="space-y-2">
          <Label for="export-password">加密密码（可选）</Label>
          <Input
            id="export-password"
            v-model="exportPassword"
            type="password"
            placeholder="留空则导出明文"
            :disabled="isExporting"
          />
          <p class="text-xs text-muted-foreground">设置密码后，备份文件将被加密保护</p>
        </div>

        <!-- 统计信息 -->
        <div class="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <span class="text-sm text-muted-foreground">当前密钥数量</span>
          <span class="text-lg font-semibold">{{ secretStore.secrets.length }}</span>
        </div>

        <Button @click="handleExport" :disabled="isExporting || secretStore.secrets.length === 0">
          <Download class="w-4 h-4 mr-2" />
          {{ isExporting ? '导出中...' : '导出备份' }}
        </Button>
      </CardContent>
    </Card>

    <!-- 导入备份 -->
    <Card>
      <CardHeader>
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
            <Upload class="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <CardTitle>导入备份</CardTitle>
            <CardDescription>从 JSON 备份文件恢复密钥</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- 读取进度 -->
        <div v-if="isReadingFile" class="flex items-center gap-3 p-3 bg-muted rounded-lg">
          <Loader2 class="w-4 h-4 animate-spin text-primary" />
          <span class="text-sm">正在读取备份文件...</span>
        </div>

        <div class="space-y-2">
          <Label>选择备份文件</Label>
          <input
            ref="importFile"
            type="file"
            accept=".json"
            :disabled="isReadingFile"
            class="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 disabled:opacity-50"
            @change="handleFileSelect"
          />
          <p class="text-xs text-muted-foreground">支持 OpenPass 备份格式或通用 JSON 密钥数组</p>
        </div>
      </CardContent>
    </Card>

    <!-- 安全提示 -->
    <Card class="border-yellow-200 bg-yellow-50">
      <CardContent class="flex items-start gap-3 pt-6">
        <AlertTriangle class="w-5 h-5 text-yellow-600 mt-0.5" />
        <div>
          <h4 class="font-medium text-yellow-800">安全提示</h4>
          <p class="text-sm text-yellow-700 mt-1">备份文件包含敏感密钥数据，请妥善保管，不要上传到公共位置！</p>
        </div>
      </CardContent>
    </Card>

    <!-- 导入对话框 -->
    <Dialog v-model:open="showImportModal">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>导入备份</DialogTitle>
          <DialogDescription>
            请确认备份信息并选择导入方式
          </DialogDescription>
        </DialogHeader>

        <!-- 备份信息 -->
        <div class="space-y-4 py-4">
          <div class="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
            <div>
              <p class="text-xs text-muted-foreground">备份版本</p>
              <p class="text-sm font-medium">v{{ backupInfo?.version || '-' }}</p>
            </div>
            <div>
              <p class="text-xs text-muted-foreground">导出时间</p>
              <p class="text-sm font-medium">{{ backupInfo?.exportTime || '-' }}</p>
            </div>
            <div>
              <p class="text-xs text-muted-foreground">密钥数量</p>
              <p class="text-sm font-medium">{{ backupInfo?.count || 0 }} 个</p>
            </div>
            <div>
              <p class="text-xs text-muted-foreground">加密状态</p>
              <p class="text-sm font-medium" :class="backupInfo?.encrypted ? 'text-orange-600' : 'text-green-600'">
                {{ backupInfo?.encrypted ? '已加密' : '明文' }}
              </p>
            </div>
          </div>

          <!-- 当前密钥数量 -->
          <div class="flex items-center justify-between p-3 border rounded-lg">
            <span class="text-sm text-muted-foreground">当前已有密钥</span>
            <span class="text-sm font-semibold">{{ secretStore.secrets.length }} 个</span>
          </div>

          <!-- 加密备份密码输入 -->
          <div v-if="isEncryptedBackup" class="space-y-3">
            <div class="p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <p class="text-sm text-orange-700">
                <AlertTriangle class="w-4 h-4 inline mr-1" />
                该备份已加密，需要输入密码才能导入
              </p>
            </div>
            <div class="space-y-2">
              <Label for="import-password">解密密码</Label>
              <Input
                id="import-password"
                v-model="importPassword"
                type="password"
                placeholder="输入备份密码"
                :disabled="isImporting"
              />
            </div>
            <p v-if="importPasswordError" class="text-sm text-destructive">
              {{ importPasswordError }}
            </p>
          </div>

          <!-- 导入方式选择 -->
          <div v-if="!isEncryptedBackup || pendingImportData?.secrets" class="space-y-3">
            <Label>导入方式</Label>
            <div class="grid grid-cols-2 gap-3">
              <button
                class="p-3 border rounded-lg text-left transition-colors"
                :class="importAction === 'merge' ? 'border-primary bg-primary/10' : 'hover:bg-muted'"
                @click="importAction = 'merge'"
                :disabled="isImporting"
              >
                <p class="text-sm font-medium">合并</p>
                <p class="text-xs text-muted-foreground">跳过重复，保留现有</p>
              </button>
              <button
                class="p-3 border rounded-lg text-left transition-colors"
                :class="importAction === 'overwrite' ? 'border-primary bg-primary/10' : 'hover:bg-muted'"
                @click="importAction = 'overwrite'"
                :disabled="isImporting"
              >
                <p class="text-sm font-medium">覆盖</p>
                <p class="text-xs text-muted-foreground">清空现有，全部替换</p>
              </button>
            </div>
          </div>

          <!-- 导入进度 -->
          <div v-if="isImporting" class="space-y-2">
            <div class="flex items-center gap-3">
              <Loader2 class="w-4 h-4 animate-spin text-primary" />
              <span class="text-sm">正在导入...</span>
            </div>
            <div class="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                class="h-full bg-primary transition-all duration-300"
                :style="{ width: importProgress + '%' }"
              />
            </div>
            <p class="text-xs text-muted-foreground text-right">{{ importProgress }}%</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" @click="cancelImport" :disabled="isImporting">
            <X class="w-4 h-4 mr-2" />
            取消
          </Button>
          <Button @click="confirmImport" :disabled="isImporting">
            <Check class="w-4 h-4 mr-2" />
            {{ isImporting ? '导入中...' : '确认导入' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>