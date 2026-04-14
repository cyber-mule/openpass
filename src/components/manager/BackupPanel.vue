<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSecretStore } from '@/stores/secrets';
import { useAutoBackup } from '@/composables/useAutoBackup';
import { showToast } from '@/utils/ui';

const secretStore = useSecretStore();
const autoBackup = useAutoBackup();

const exportPassword = ref('');
const importFile = ref<HTMLInputElement | null>(null);
const importPassword = ref('');
const pendingImportData = ref<any>(null);
const showImportConfirm = ref(false);
const duplicateAction = ref<'skip' | 'overwrite' | 'both'>('skip');
const isExporting = ref(false);
const isImporting = ref(false);

onMounted(async () => {
  await autoBackup.loadSettings();
});

async function handleExport() {
  if (secretStore.secrets.length === 0) {
    showToast('没有可导出的密钥', 'warning');
    return;
  }

  isExporting.value = true;
  try {
    const blob = await secretStore.exportSecrets(exportPassword.value || undefined);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const suffix = exportPassword.value ? '-encrypted' : '';
    a.download = `openpass-backup-${new Date().toISOString().split('T')[0]}${suffix}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${secretStore.secrets.length} 个密钥${exportPassword.value ? '（已加密）' : ''}`, 'success');
    exportPassword.value = '';
  } catch (error) {
    showToast('导出失败: ' + (error as Error).message, 'error');
  } finally {
    isExporting.value = false;
  }
}

function handleFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const content = e.target?.result as string;
      const data = JSON.parse(content);

      // 验证备份格式
      if (!data.format || !data.secrets) {
        showToast('无效的备份文件格式', 'error');
        return;
      }

      pendingImportData.value = data;
      showImportConfirm.value = true;
    } catch (error) {
      showToast('读取文件失败: ' + (error as Error).message, 'error');
    }
  };
  reader.readAsText(file);
}

async function confirmImport() {
  if (!pendingImportData.value) return;

  isImporting.value = true;
  try {
    let secretsToImport = pendingImportData.value.secrets;

    // 如果有加密数据，需要解密
    if (pendingImportData.value.encryptedData) {
      if (!importPassword.value) {
        showToast('请输入解密密码', 'warning');
        return;
      }
      // 解密逻辑在 importSecrets 中处理
    }

    // 处理重复密钥
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
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            importedAt: new Date().toISOString()
          });
          addedCount++;
        }
      } else {
        secretStore.secrets.push({
          ...secret,
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
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

    // 重置状态
    showImportConfirm.value = false;
    pendingImportData.value = null;
    importPassword.value = '';
    if (importFile.value) importFile.value.value = '';
  } catch (error) {
    showToast('导入失败: ' + (error as Error).message, 'error');
  } finally {
    isImporting.value = false;
  }
}

function cancelImport() {
  showImportConfirm.value = false;
  pendingImportData.value = null;
  importPassword.value = '';
  if (importFile.value) importFile.value.value = '';
}
</script>

<template>
  <div class="space-y-6">
    <header class="page-header">
      <h1 class="text-2xl font-bold text-gray-900">备份恢复</h1>
    </header>

    <!-- 导出备份 -->
    <div class="bg-white rounded-lg shadow p-6">
      <div class="flex items-start space-x-4">
        <div class="flex-shrink-0 w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
          <svg class="w-6 h-6 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div class="flex-1">
          <h3 class="text-lg font-semibold text-gray-900">导出备份</h3>
          <p class="text-sm text-gray-600 mt-1">将所有密钥导出为 JSON 文件，保存到本地</p>

          <div class="mt-4 space-y-3">
            <div>
              <label class="block text-sm font-medium text-gray-700">加密密码（可选）</label>
              <input
                v-model="exportPassword"
                type="password"
                placeholder="留空则导出明文"
                class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
              <p class="mt-1 text-xs text-gray-500">设置密码后，备份文件将被加密保护</p>
            </div>

            <button
              class="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="isExporting"
              @click="handleExport"
            >
              <svg class="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {{ isExporting ? '导出中...' : '导出备份' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 导入备份 -->
    <div class="bg-white rounded-lg shadow p-6">
      <div class="flex items-start space-x-4">
        <div class="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
          <svg class="w-6 h-6 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>
        <div class="flex-1">
          <h3 class="text-lg font-semibold text-gray-900">导入备份</h3>
          <p class="text-sm text-gray-600 mt-1">从 JSON 备份文件恢复密钥</p>

          <div class="mt-4 space-y-3">
            <div>
              <label class="block text-sm font-medium text-gray-700">选择备份文件</label>
              <input
                ref="importFile"
                type="file"
                accept=".json"
                class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                @change="handleFileSelect"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700">解密密码（如果备份已加密）</label>
              <input
                v-model="importPassword"
                type="password"
                placeholder="输入解密密码"
                class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <button
              class="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="!pendingImportData || isImporting"
              @click="confirmImport"
            >
              <svg class="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {{ isImporting ? '导入中...' : '导入备份' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 导入确认对话框 -->
      <div v-if="showImportConfirm" class="mt-4 p-4 bg-gray-50 rounded-lg">
        <h4 class="text-sm font-medium text-gray-900 mb-3">发现重复密钥，请选择处理方式：</h4>
        <div class="space-y-2">
          <label class="flex items-center space-x-2">
            <input type="radio" v-model="duplicateAction" value="skip" class="text-primary-600" />
            <span class="text-sm text-gray-700">跳过重复项</span>
          </label>
          <label class="flex items-center space-x-2">
            <input type="radio" v-model="duplicateAction" value="overwrite" class="text-primary-600" />
            <span class="text-sm text-gray-700">覆盖重复项</span>
          </label>
          <label class="flex items-center space-x-2">
            <input type="radio" v-model="duplicateAction" value="both" class="text-primary-600" />
            <span class="text-sm text-gray-700">保留两者（添加新条目）</span>
          </label>
        </div>
        <div class="mt-4 flex space-x-3">
          <button class="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700" @click="confirmImport">
            确认导入
          </button>
          <button class="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400" @click="cancelImport">
            取消
          </button>
        </div>
      </div>
    </div>

    <!-- 安全提示 -->
    <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
      <div class="flex items-start space-x-3">
        <svg class="w-5 h-5 text-yellow-600 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div>
          <h4 class="text-sm font-medium text-yellow-800">安全提示</h4>
          <p class="text-sm text-yellow-700 mt-1">备份文件包含敏感密钥数据，请妥善保管，不要上传到公共位置！</p>
        </div>
      </div>
    </div>
  </div>
</template>