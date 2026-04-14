<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useSecretStore } from '@/stores/secrets';
import { useAuthStore } from '@/stores/auth';
import { useAutoBackup } from '@/composables/useAutoBackup';
import { showToast } from '@/utils/ui';
import CryptoUtils from '@/utils/crypto';

const secretStore = useSecretStore();
const authStore = useAuthStore();
const autoBackup = useAutoBackup();

// 自动备份设置
const enableAutoBackup = ref(false);
const backupFrequency = ref<'daily' | 'weekly' | 'monthly'>('weekly');
const enableLocalSnapshot = ref(true);
const enableDirectoryBackup = ref(false);
const lastBackupTime = ref<string | null>(null);
const nextBackupTime = ref<string>('');

// 主密码修改
const showPasswordModal = ref(false);
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');

// 备份加密设置
const enableBackupEncryption = ref(false);
const useMasterPasswordForBackup = ref(true);
const backupPassword = ref('');
const backupPasswordConfirm = ref('');

// 状态
const saving = ref(false);
const backingUp = ref(false);

// 计算下次备份时间
const backupIntervalMap = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000
};

onMounted(async () => {
  await loadAllSettings();
});

async function loadAllSettings() {
  await autoBackup.loadSettings();
  enableAutoBackup.value = autoBackup.settings.value.enableAutoBackup;
  backupFrequency.value = autoBackup.settings.value.backupFrequency;
  enableLocalSnapshot.value = autoBackup.settings.value.enableLocalSnapshot;
  enableDirectoryBackup.value = autoBackup.settings.value.enableDirectoryBackup;
  lastBackupTime.value = autoBackup.settings.value.lastBackupTime;

  // 计算下次备份时间
  updateNextBackupTime();

  // 加载备份加密设置
  const encryptionResult = await chrome.storage.local.get([
    'enableBackupEncryption',
    'useMasterPasswordForBackup'
  ]);
  enableBackupEncryption.value = encryptionResult.enableBackupEncryption || false;
  useMasterPasswordForBackup.value = encryptionResult.useMasterPasswordForBackup !== false;
}

function updateNextBackupTime() {
  if (!enableAutoBackup.value) {
    nextBackupTime.value = '-';
    return;
  }

  if (lastBackupTime.value) {
    const lastDate = new Date(lastBackupTime.value);
    const interval = backupIntervalMap[backupFrequency.value];
    const nextDate = new Date(lastDate.getTime() + interval);
    const now = new Date();

    if (nextDate <= now) {
      nextBackupTime.value = '待执行';
    } else {
      const diffMs = nextDate.getTime() - now.getTime();
      const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
      const diffHours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

      if (diffDays > 0) {
        nextBackupTime.value = `${diffDays} 天后`;
      } else if (diffHours > 0) {
        nextBackupTime.value = `${diffHours} 小时后`;
      } else {
        nextBackupTime.value = '即将';
      }
    }
  } else {
    nextBackupTime.value = '待执行';
  }
}

async function saveBackupSettings() {
  saving.value = true;
  try {
    await autoBackup.saveSettings({
      enableAutoBackup: enableAutoBackup.value,
      backupFrequency: backupFrequency.value,
      enableLocalSnapshot: enableLocalSnapshot.value,
      enableDirectoryBackup: enableDirectoryBackup.value
    });

    // 保存备份加密设置
    await chrome.storage.local.set({
      enableBackupEncryption: enableBackupEncryption.value,
      useMasterPasswordForBackup: useMasterPasswordForBackup.value
    });

    updateNextBackupTime();
    showToast('设置已保存', 'success');
  } finally {
    saving.value = false;
  }
}

async function handleBackupNow() {
  if (secretStore.secrets.length === 0) {
    showToast('没有可备份的密钥', 'warning');
    return;
  }

  backingUp.value = true;
  try {
    let password = null;
    if (enableBackupEncryption.value && useMasterPasswordForBackup.value) {
      password = authStore.sessionKey;
    }

    await autoBackup.triggerChangeBackup(secretStore.secrets, { password });
    lastBackupTime.value = new Date().toISOString();
    updateNextBackupTime();
    showToast('备份成功', 'success');
  } catch (error) {
    showToast('备份失败: ' + (error as Error).message, 'error');
  } finally {
    backingUp.value = false;
  }
}

function openPasswordModal() {
  currentPassword.value = '';
  newPassword.value = '';
  confirmPassword.value = '';
  showPasswordModal.value = true;
}

async function changePassword() {
  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
    showToast('请填写所有字段', 'warning');
    return;
  }

  if (newPassword.value !== confirmPassword.value) {
    showToast('新密码两次输入不一致', 'error');
    return;
  }

  if (newPassword.value.length < 6) {
    showToast('新密码至少需要 6 个字符', 'warning');
    return;
  }

  try {
    // 验证当前密码
    const result = await chrome.storage.local.get(['masterPasswordHash', 'masterPasswordSalt']);
    if (!result.masterPasswordHash || !result.masterPasswordSalt) {
      showToast('系统错误', 'error');
      return;
    }

    const isValid = await CryptoUtils.verifyMasterPassword(
      currentPassword.value,
      result.masterPasswordHash,
      result.masterPasswordSalt
    );

    if (!isValid) {
      showToast('当前密码错误', 'error');
      return;
    }

    // 创建新密码哈希
    const newHash = await CryptoUtils.createMasterPasswordHash(newPassword.value);

    // 如果有加密的密钥，需要重新加密
    const secretsResult = await chrome.storage.local.get(['encryptedSecrets']);
    if (secretsResult.encryptedSecrets) {
      // 使用旧密码解密
      const decrypted = await CryptoUtils.decrypt(secretsResult.encryptedSecrets, currentPassword.value);
      // 使用新密码加密
      const newEncrypted = await CryptoUtils.encrypt(decrypted, newPassword.value);
      await chrome.storage.local.set({
        masterPasswordHash: newHash.hash,
        masterPasswordSalt: newHash.salt,
        encryptedSecrets: newEncrypted
      });
    } else {
      await chrome.storage.local.set({
        masterPasswordHash: newHash.hash,
        masterPasswordSalt: newHash.salt
      });
    }

    // 更新会话
    await authStore.createSession(newPassword.value);

    showPasswordModal.value = false;
    showToast('主密码已更新', 'success');
  } catch (error) {
    showToast('修改失败: ' + (error as Error).message, 'error');
  }
}

async function clearAllSecrets() {
  if (!confirm('确定要清空所有密钥吗？此操作不可撤销！')) return;

  try {
    secretStore.secrets = [];
    await secretStore.saveSecrets();
    await chrome.storage.local.remove(['backupSnapshots']);
    showToast('所有密钥已清空', 'success');
  } catch (error) {
    showToast('清空失败: ' + (error as Error).message, 'error');
  }
}

async function resetAllData() {
  if (!confirm('确定要重置所有数据吗？此操作将删除所有密钥、设置和主密码，恢复到初始状态！')) return;
  if (!confirm('再次确认：这将永久删除所有数据，无法恢复！')) return;

  try {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    showToast('所有数据已重置', 'success');
    // 重新加载页面
    window.location.reload();
  } catch (error) {
    showToast('重置失败: ' + (error as Error).message, 'error');
  }
}

// 格式化上次备份时间
const formattedLastBackupTime = computed(() => {
  if (!lastBackupTime.value) return '从未备份';

  const lastDate = new Date(lastBackupTime.value);
  const now = new Date();
  const diffMs = now.getTime() - lastDate.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));

  if (diffDays > 0) {
    return `${diffDays} 天前`;
  } else if (diffHours > 0) {
    return `${diffHours} 小时前`;
  } else {
    return '刚刚';
  }
});
</script>

<template>
  <div class="space-y-6">
    <header class="page-header">
      <h1 class="text-2xl font-bold text-gray-900">设置</h1>
    </header>

    <!-- 主密码设置 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-2">主密码</h3>
      <p class="text-sm text-gray-600 mb-4">主密码用于保护密钥数据和管理页面访问</p>
      <button
        class="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
        @click="openPasswordModal"
      >
        <svg class="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        修改主密码
      </button>
    </div>

    <!-- 备份加密设置 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-2">备份加密</h3>
      <p class="text-sm text-gray-600 mb-4">启用后导出的备份文件将加密存储，导入时需要输入密码解密</p>

      <div class="space-y-4">
        <label class="flex items-center space-x-3">
          <input
            v-model="enableBackupEncryption"
            type="checkbox"
            class="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
          />
          <span class="text-sm text-gray-700">启用备份加密</span>
        </label>

        <div v-if="enableBackupEncryption" class="ml-7 space-y-4">
          <label class="flex items-center space-x-3">
            <input
              v-model="useMasterPasswordForBackup"
              type="checkbox"
              class="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
            />
            <span class="text-sm text-gray-700">使用主密码作为备份密码</span>
          </label>
          <p class="text-xs text-gray-500">启用后将使用主密码加密备份，无需单独记忆</p>
        </div>

        <button
          class="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
          :disabled="saving"
          @click="saveBackupSettings"
        >
          保存加密设置
        </button>
      </div>
    </div>

    <!-- 自动备份设置 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-2">自动备份</h3>
      <p class="text-sm text-gray-600 mb-4">定期检查并自动备份密钥数据，防止数据丢失</p>

      <div class="space-y-4">
        <label class="flex items-center space-x-3">
          <input
            v-model="enableAutoBackup"
            type="checkbox"
            class="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
            @change="updateNextBackupTime"
          />
          <span class="text-sm text-gray-700">启用自动备份</span>
        </label>

        <div v-if="enableAutoBackup" class="ml-7 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">备份频率</label>
            <select
              v-model="backupFrequency"
              class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              @change="updateNextBackupTime"
            >
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </div>

          <label class="flex items-center space-x-3">
            <input
              v-model="enableLocalSnapshot"
              type="checkbox"
              class="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
            />
            <span class="text-sm text-gray-700">本地快照</span>
          </label>
          <p class="text-xs text-gray-500 ml-7">在浏览器中保留最近 5 个备份版本</p>

          <label class="flex items-center space-x-3">
            <input
              v-model="enableDirectoryBackup"
              type="checkbox"
              class="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
            />
            <span class="text-sm text-gray-700">自动保存到本地目录</span>
          </label>
          <p class="text-xs text-gray-500 ml-7">授权目录后自动写入备份文件（需 Chrome 86+）</p>

          <!-- 备份时间信息 -->
          <div class="bg-gray-50 rounded-lg p-4 space-y-2">
            <div class="flex justify-between text-sm">
              <span class="text-gray-600">上次备份</span>
              <span class="text-gray-900" :title="lastBackupTime ? new Date(lastBackupTime).toLocaleString('zh-CN') : ''">
                {{ formattedLastBackupTime }}
              </span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-gray-600">下次备份</span>
              <span class="text-gray-900" :class="{ 'text-yellow-600': nextBackupTime === '待执行' }">
                {{ nextBackupTime }}
              </span>
            </div>
          </div>

          <!-- 立即备份按钮 -->
          <button
            class="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50"
            :disabled="backingUp"
            @click="handleBackupNow"
          >
            <svg class="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {{ backingUp ? '备份中...' : '立即备份' }}
          </button>
        </div>

        <button
          class="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
          :disabled="saving"
          @click="saveBackupSettings"
        >
          保存备份设置
        </button>
      </div>
    </div>

    <!-- 危险操作区域 -->
    <div class="bg-white rounded-lg shadow p-6 border-2 border-red-200">
      <h3 class="text-lg font-semibold text-red-600 mb-2">危险操作</h3>
      <p class="text-sm text-gray-600 mb-4">以下操作不可撤销，请谨慎使用</p>

      <div class="space-y-4">
        <div class="flex items-center justify-between py-3 border-b border-gray-200">
          <div>
            <span class="text-sm font-medium text-gray-900">清空所有密钥</span>
            <p class="text-xs text-gray-500">删除所有已保存的密钥和备份快照，保留其他设置</p>
          </div>
          <button
            class="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            @click="clearAllSecrets"
          >
            清空密钥
          </button>
        </div>

        <div class="flex items-center justify-between py-3">
          <div>
            <span class="text-sm font-medium text-gray-900">重置所有数据</span>
            <p class="text-xs text-gray-500">删除所有密钥、设置、主密码，恢复到初始状态</p>
          </div>
          <button
            class="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            @click="resetAllData"
          >
            重置数据
          </button>
        </div>
      </div>
    </div>

    <!-- 修改密码模态框 -->
    <div v-if="showPasswordModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">修改主密码</h3>

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">当前密码</label>
            <input
              v-model="currentPassword"
              type="password"
              class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="输入当前主密码"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">新密码</label>
            <input
              v-model="newPassword"
              type="password"
              class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="输入新主密码"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">确认新密码</label>
            <input
              v-model="confirmPassword"
              type="password"
              class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="再次输入新主密码"
            />
          </div>
        </div>

        <div class="mt-6 flex space-x-3 justify-end">
          <button
            class="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
            @click="showPasswordModal = false"
          >
            取消
          </button>
          <button
            class="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
            @click="changePassword"
          >
            确认修改
          </button>
        </div>
      </div>
    </div>
  </div>
</template>