<script setup lang="ts">
import { ref, onMounted } from 'vue';
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
import { Upload, Download, AlertTriangle, Check, X } from 'lucide-vue-next';

const secretStore = useSecretStore();
const autoBackup = useAutoBackup();
const authStore = useAuthStore();

// 导出相关
const exportPassword = ref('');
const isExporting = ref(false);

// 导入相关
const importFile = ref<HTMLInputElement | null>(null);
const pendingImportData = ref<any>(null);
const isEncryptedBackup = ref(false);
const importPassword = ref('');
const importPasswordError = ref('');
const showPasswordDialog = ref(false);
const showDuplicateDialog = ref(false);
const duplicateAction = ref<'skip' | 'overwrite' | 'both'>('skip');
const isImporting = ref(false);

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
  try {
    let password = exportPassword.value || undefined;
    
    // 如果启用了加密设置且使用主密码
    if (enableBackupEncryption.value && useMasterPasswordForBackup.value && !password) {
      password = authStore.sessionKey;
    }

    const backupData = await autoBackup.createBackup(secretStore.secrets, { password });
    
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
  } catch (error: any) {
    showToast('导出失败: ' + error.message, 'error');
  } finally {
    isExporting.value = false;
  }
}

// 选择文件导入
function handleFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;
      const data = JSON.parse(content);

      // 验证备份格式
      const validation = validateBackup(data);
      if (!validation.valid) {
        showToast(validation.error || '无效的备份文件格式', 'error');
        return;
      }

      pendingImportData.value = validation.data;
      isEncryptedBackup.value = validation.encrypted || false;

      // 如果是加密备份，弹出密码输入对话框
      if (isEncryptedBackup.value) {
        importPassword.value = '';
        importPasswordError.value = '';
        showPasswordDialog.value = true;
      } else {
        // 明文备份，检查是否有重复
        checkDuplicatesAndImport();
      }
    } catch (error: any) {
      showToast('读取文件失败: ' + error.message, 'error');
    }
  };
  reader.readAsText(file);
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
      secrets: data
    };
  } else if (Array.isArray(data.secrets)) {
    // 兼容其他包含 secrets 字段的格式
    data = {
      format: 'openpass-backup',
      formatVersion: 0,
      appVersion: data.appVersion || '0.0.0',
      secrets: data.secrets
    };
  } else {
    return { valid: false, error: '无法识别的备份格式' };
  }

  return { valid: true, data, encrypted: false };
}

// 解密加密备份
async function decryptBackup() {
  if (!importPassword.value) {
    importPasswordError.value = '请输入解密密码';
    return;
  }

  try {
    const decrypted = await CryptoUtils.decrypt(
      pendingImportData.value.encryptedData,
      importPassword.value
    );
    
    pendingImportData.value.secrets = JSON.parse(decrypted);
    pendingImportData.value.encrypted = false;
    pendingImportData.value.encryptedData = undefined;
    
    showPasswordDialog.value = false;
    isEncryptedBackup.value = false;
    
    // 检查是否有重复
    checkDuplicatesAndImport();
  } catch (error: any) {
    importPasswordError.value = '解密失败，请检查密码是否正确';
  }
}

// 检查是否有重复密钥
function checkDuplicatesAndImport() {
  if (!pendingImportData.value?.secrets) {
    showToast('备份数据无效', 'error');
    resetImport();
    return;
  }

  const secretsToImport = pendingImportData.value.secrets;
  let hasDuplicates = false;

  for (const secret of secretsToImport) {
    const existingIndex = secretStore.secrets.findIndex(
      s => s.site.toLowerCase() === secret.site.toLowerCase() &&
           s.secret.toUpperCase() === secret.secret.toUpperCase()
    );
    if (existingIndex !== -1) {
      hasDuplicates = true;
      break;
    }
  }

  if (hasDuplicates) {
    showDuplicateDialog.value = true;
  } else {
    performImport();
  }
}

// 执行导入
async function performImport() {
  if (!pendingImportData.value?.secrets) return;

  isImporting.value = true;
  try {
    const secretsToImport = pendingImportData.value.secrets;
    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const secret of secretsToImport) {
      const existingIndex = secretStore.secrets.findIndex(
        s => s.site.toLowerCase() === secret.site.toLowerCase() &&
             s.secret.toUpperCase() === secret.secret.toUpperCase()
      );

      if (existingIndex !== -1) {
        if (duplicateAction.value === 'skip') {
          skippedCount++;
        } else if (duplicateAction.value === 'overwrite') {
          secretStore.secrets[existingIndex] = {
            ...secretStore.secrets[existingIndex],
            secret: secret.secret,
            digits: secret.digits || 6,
            name: secret.name || secretStore.secrets[existingIndex].name,
            updatedAt: new Date().toISOString()
          };
          updatedCount++;
        } else if (duplicateAction.value === 'both') {
          secretStore.secrets.push({
            ...secret,
            id: crypto.randomUUID(),
            importedAt: new Date().toISOString()
          });
          addedCount++;
        }
      } else {
        secretStore.secrets.push({
          ...secret,
          id: crypto.randomUUID(),
          importedAt: new Date().toISOString()
        });
        addedCount++;
      }
    }

    await secretStore.saveSecrets();

    const messages = [];
    if (addedCount > 0) messages.push(`新增 ${addedCount} 个`);
    if (updatedCount > 0) messages.push(`更新 ${updatedCount} 个`);
    if (skippedCount > 0) messages.push(`跳过 ${skippedCount} 个`);

    showToast(`导入完成：${messages.join('，')}`, 'success');
    resetImport();
  } catch (error: any) {
    showToast('导入失败: ' + error.message, 'error');
  } finally {
    isImporting.value = false;
  }
}

// 重置导入状态
function resetImport() {
  showPasswordDialog.value = false;
  showDuplicateDialog.value = false;
  pendingImportData.value = null;
  isEncryptedBackup.value = false;
  importPassword.value = '';
  importPasswordError.value = '';
  duplicateAction.value = 'skip';
  if (importFile.value) importFile.value.value = '';
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
        <div class="space-y-2">
          <Label for="export-password">加密密码（可选）</Label>
          <Input
            id="export-password"
            v-model="exportPassword"
            type="password"
            placeholder="留空则导出明文"
          />
          <p class="text-xs text-muted-foreground">设置密码后，备份文件将被加密保护</p>
        </div>

        <Button @click="handleExport" :disabled="isExporting">
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
        <div class="space-y-2">
          <Label>选择备份文件</Label>
          <input
            ref="importFile"
            type="file"
            accept=".json"
            class="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
            @change="handleFileSelect"
          />
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

    <!-- 解密密码对话框 -->
    <Dialog v-model:open="showPasswordDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>输入解密密码</DialogTitle>
          <DialogDescription>
            该备份文件已加密，请输入创建备份时设置的密码
          </DialogDescription>
        </DialogHeader>
        
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label for="decrypt-password">解密密码</Label>
            <Input
              id="decrypt-password"
              v-model="importPassword"
              type="password"
              placeholder="输入解密密码"
              autofocus
            />
          </div>
          <p v-if="importPasswordError" class="text-sm text-destructive">
            {{ importPasswordError }}
          </p>
        </div>

        <DialogFooter>
          <Button variant="secondary" @click="cancelImport">
            <X class="w-4 h-4 mr-2" />
            取消
          </Button>
          <Button @click="decryptBackup">
            <Check class="w-4 h-4 mr-2" />
            解密并导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 重复密钥处理对话框 -->
    <Dialog v-model:open="showDuplicateDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发现重复密钥</DialogTitle>
          <DialogDescription>
            备份文件中包含与现有密钥重复的条目，请选择处理方式
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3 py-4">
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="radio" v-model="duplicateAction" value="skip" class="h-4 w-4" />
            <span class="text-sm">跳过重复项（保留现有密钥）</span>
          </label>
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="radio" v-model="duplicateAction" value="overwrite" class="h-4 w-4" />
            <span class="text-sm">覆盖重复项（使用备份密钥）</span>
          </label>
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="radio" v-model="duplicateAction" value="both" class="h-4 w-4" />
            <span class="text-sm">保留两者（添加为新条目）</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="secondary" @click="cancelImport">
            取消
          </Button>
          <Button @click="performImport" :disabled="isImporting">
            {{ isImporting ? '导入中...' : '确认导入' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>