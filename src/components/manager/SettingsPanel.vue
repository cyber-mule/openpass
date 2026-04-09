<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSecretStore } from '@/stores/secrets';
import { useAutoBackup } from '@/composables/useAutoBackup';
import { showToast } from '@/utils/ui';

const secretStore = useSecretStore();
const autoBackup = useAutoBackup();

const enableAutoBackup = ref(false);
const backupFrequency = ref<'daily' | 'weekly' | 'monthly'>('weekly');
const enableLocalSnapshot = ref(true);
const lastBackupTime = ref<string | null>(null);

const exportPassword = ref('');
const importFile = ref<HTMLInputElement | null>(null);
const importPassword = ref('');

onMounted(async () => {
  await autoBackup.loadSettings();
  enableAutoBackup.value = autoBackup.settings.value.enableAutoBackup;
  backupFrequency.value = autoBackup.settings.value.backupFrequency;
  enableLocalSnapshot.value = autoBackup.settings.value.enableLocalSnapshot;
  lastBackupTime.value = autoBackup.settings.value.lastBackupTime;
});

async function saveBackupSettings() {
  await autoBackup.saveSettings({
    enableAutoBackup: enableAutoBackup.value,
    backupFrequency: backupFrequency.value,
    enableLocalSnapshot: enableLocalSnapshot.value
  });
  showToast('设置已保存', 'success');
}

async function handleExport() {
  try {
    const blob = await secretStore.exportSecrets(exportPassword.value || undefined);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openpass-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('导出成功', 'success');
  } catch (error) {
    showToast('导出失败: ' + (error as Error).message, 'error');
  }
}

async function handleImport() {
  const file = importFile.value?.files?.[0];
  if (!file) {
    showToast('请选择备份文件', 'warning');
    return;
  }

  try {
    const count = await secretStore.importSecrets(file, importPassword.value || undefined);
    showToast(`成功导入 ${count} 个密钥`, 'success');
    importPassword.value = '';
    if (importFile.value) importFile.value.value = '';
  } catch (error) {
    showToast('导入失败: ' + (error as Error).message, 'error');
  }
}
</script>

<template>
  <div class="space-y-6">
    <h2 class="text-2xl font-bold text-gray-900">设置</h2>

    <!-- 自动备份 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-4">自动备份</h3>

      <div class="space-y-4">
        <label class="flex items-center space-x-3">
          <input v-model="enableAutoBackup" type="checkbox" class="w-4 h-4 text-primary-600" />
          <span class="text-sm text-gray-700">启用自动备份</span>
        </label>

        <div v-if="enableAutoBackup" class="ml-7 space-y-3">
          <div>
            <label class="form-label">备份频率</label>
            <select v-model="backupFrequency" class="input mt-1">
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </div>

          <label class="flex items-center space-x-3">
            <input v-model="enableLocalSnapshot" type="checkbox" class="w-4 h-4 text-primary-600" />
            <span class="text-sm text-gray-700">保存本地快照</span>
          </label>
        </div>

        <p v-if="lastBackupTime" class="text-xs text-gray-500">
          上次备份: {{ new Date(lastBackupTime).toLocaleString('zh-CN') }}
        </p>

        <button class="btn-primary" @click="saveBackupSettings">
          保存备份设置
        </button>
      </div>
    </div>

    <!-- 导出密钥 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-4">导出</h3>

      <div class="space-y-4">
        <div>
          <label class="form-label">加密密码（可选）</label>
          <input
            v-model="exportPassword"
            type="password"
            placeholder="留空则导出明文"
            class="input mt-1"
          />
        </div>

        <button class="btn-primary" @click="handleExport">
          <svg class="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          导出备份文件
        </button>
      </div>
    </div>

    <!-- 导入密钥 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-4">导入</h3>

      <div class="space-y-4">
        <div>
          <label class="form-label">备份文件</label>
          <input
            ref="importFile"
            type="file"
            accept=".json"
            class="input mt-1"
          />
        </div>

        <div>
          <label class="form-label">解密密码（如果备份已加密）</label>
          <input
            v-model="importPassword"
            type="password"
            placeholder="输入解密密码"
            class="input mt-1"
          />
        </div>

        <button class="btn-primary" @click="handleImport">
          <svg class="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          导入备份文件
        </button>
      </div>
    </div>

    <!-- 关于 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-4">关于</h3>
      <div class="space-y-2 text-sm text-gray-600">
        <p>版本: v{{ chrome.runtime.getManifest().version }}</p>
        <p>
          源码:
          <a href="https://github.com/cyber-mule/openpass" target="_blank" class="text-primary-600 hover:underline">
            GitHub
          </a>
        </p>
      </div>
    </div>
  </div>
</template>
