<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useSecretStore } from '@/stores/secrets';
import { useAutoBackup } from '@/composables/useAutoBackup';
import { useAuthStore } from '@/stores/auth';
import { showToast } from '@/utils/ui';
import CryptoUtils from '@/utils/crypto';

const secretStore = useSecretStore();
const autoBackup = useAutoBackup();
const authStore = useAuthStore();

// 导出相关
const exportPassword = ref('');
const isExporting = ref(false);

// 导入相关
const importFile = ref<HTMLInputElement | null>(null);
const isReadingFile = ref(false);
const pendingImportData = ref<any>(null);
const isEncryptedBackup = ref(false);
const importPassword = ref('');
const importPasswordError = ref('');
const showImportModal = ref(false);
const isImporting = ref(false);
const importAction = ref<'merge' | 'overwrite'>('merge');

// 加密设置
const enableBackupEncryption = ref(false);
const useMasterPasswordForBackup = ref(true);

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

onMounted(async () => {
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
    let password: string | undefined = undefined;

    // 如果启用了加密
    if (enableBackupEncryption.value) {
      if (useMasterPasswordForBackup.value && authStore.sessionKey) {
        password = authStore.sessionKey;
      } else if (exportPassword.value) {
        password = exportPassword.value;
      } else {
        showToast('加密备份需要密码，请先设置密码或在下方输入', 'warning');
        isExporting.value = false;
        return;
      }
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
function triggerImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = handleFileSelect;
  input.click();
}

async function handleFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  isReadingFile.value = true;

  try {
    const content = await file.text();
    const data = JSON.parse(content);

    // 验证备份格式
    if (data.format === 'openpass-backup') {
      if (data.encrypted && data.encryptedData) {
        pendingImportData.value = data;
        isEncryptedBackup.value = true;
      } else if (Array.isArray(data.secrets)) {
        pendingImportData.value = data;
        isEncryptedBackup.value = false;
      }
    } else if (Array.isArray(data)) {
      pendingImportData.value = { secrets: data, count: data.length };
      isEncryptedBackup.value = false;
    } else if (Array.isArray(data.secrets)) {
      pendingImportData.value = data;
      isEncryptedBackup.value = false;
    } else {
      showToast('无法识别的备份格式', 'error');
      isReadingFile.value = false;
      return;
    }

    showImportModal.value = true;
    importPassword.value = '';
    importPasswordError.value = '';
    importAction.value = 'merge';
  } catch {
    showToast('读取文件失败', 'error');
  } finally {
    isReadingFile.value = false;
  }
}

// 解密并导入
async function decryptAndImport() {
  if (!importPassword.value) {
    importPasswordError.value = '请输入解密密码';
    return;
  }

  isImporting.value = true;
  importPasswordError.value = '';

  try {
    const decrypted = await CryptoUtils.decrypt(
      pendingImportData.value.encryptedData,
      importPassword.value
    );
    pendingImportData.value.secrets = JSON.parse(decrypted);
    pendingImportData.value.encrypted = false;
    await performImport();
  } catch {
    importPasswordError.value = '解密失败，请检查密码是否正确';
    isImporting.value = false;
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

  try {
    let addedCount = 0;
    let skippedCount = 0;

    if (importAction.value === 'overwrite') {
      // 覆盖模式
      if (!confirm('覆盖将删除所有现有密钥，确定继续吗？')) {
        isImporting.value = false;
        return;
      }
      secretStore.secrets = secretsToImport.map((secret: any) => ({
        ...secret,
        id: secret.id || crypto.randomUUID(),
        importedAt: new Date().toISOString()
      }));
      addedCount = secretsToImport.length;
    } else {
      // 合并模式
      for (const secret of secretsToImport) {
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
      }
    }

    await secretStore.saveSecrets();

    showImportModal.value = false;
    pendingImportData.value = null;

    showToast(
      skippedCount > 0 
        ? `已导入 ${addedCount} 个，跳过 ${skippedCount} 个重复` 
        : `已导入 ${addedCount} 个密钥`,
      'success'
    );
  } catch (error: any) {
    showToast('导入失败: ' + error.message, 'error');
  } finally {
    isImporting.value = false;
  }
}

function resetImport() {
  showImportModal.value = false;
  pendingImportData.value = null;
  importPassword.value = '';
  importPasswordError.value = '';
}
</script>

<template>
  <header class="page-header">
    <h1>备份恢复</h1>
  </header>

  <div class="page-content">
    <div class="backup-sections">
      <!-- 导出备份 -->
      <section class="backup-section">
        <div class="section-icon export">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
        </div>
        <h2>导出备份</h2>
        <p>将所有密钥导出为 JSON 文件，保存到本地</p>

        <!-- 加密提示 -->
        <div v-if="enableBackupEncryption && !useMasterPasswordForBackup" class="export-password-input">
          <label>备份密码</label>
          <input
            type="password"
            v-model="exportPassword"
            class="form-input"
            placeholder="输入备份加密密码"
          >
        </div>

        <button class="btn-primary" :disabled="isExporting" @click="handleExport">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          {{ isExporting ? '导出中...' : '导出备份' }}
        </button>
      </section>

      <!-- 导入备份 -->
      <section class="backup-section">
        <div class="section-icon import">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </div>
        <h2>导入备份</h2>
        <p>从 JSON 备份文件恢复密钥</p>
        <button class="btn-secondary" :disabled="isReadingFile" @click="triggerImport">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          {{ isReadingFile ? '读取中...' : '选择文件' }}
        </button>
      </section>
    </div>

    <!-- 安全提示 -->
    <div class="backup-warning">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
      <div>
        <strong>安全提示</strong>
        <p>备份文件包含明文密钥，请妥善保管，不要上传到公共位置！</p>
      </div>
    </div>

    <!-- 导入模态框 -->
    <div v-if="showImportModal" class="modal">
      <div class="modal-overlay"></div>
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>导入备份</h3>
          <button class="modal-close" @click="resetImport">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <!-- 备份信息 -->
          <div v-if="backupInfo" class="backup-info">
            <div class="backup-info-item">
              <span class="backup-info-label">备份版本</span>
              <span class="backup-info-value">v{{ backupInfo.version }}</span>
            </div>
            <div class="backup-info-item">
              <span class="backup-info-label">导出时间</span>
              <span class="backup-info-value">{{ backupInfo.exportTime }}</span>
            </div>
            <div class="backup-info-item">
              <span class="backup-info-label">密钥数量</span>
              <span class="backup-info-value">{{ backupInfo.count }} 个</span>
            </div>
          </div>

          <!-- 当前密钥数量 -->
          <p class="modal-text">
            检测到备份包含 <strong>{{ backupInfo?.count || 0 }}</strong> 个密钥，
            当前已有 <strong>{{ secretStore.secrets.length }}</strong> 个密钥。
          </p>

          <!-- 解密区域 -->
          <div v-if="isEncryptedBackup" class="decrypt-section">
            <div class="decrypt-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <p class="decrypt-title">此备份已加密</p>
            <p class="decrypt-desc">请输入备份密码以解密</p>
            <input
              type="password"
              v-model="importPassword"
              class="form-input"
              placeholder="输入备份密码"
            >
            <p v-if="importPasswordError" class="form-error">{{ importPasswordError }}</p>
          </div>

          <!-- 导入方式选择 -->
          <div v-if="!isEncryptedBackup || importPassword" class="import-action">
            <p class="import-action-label">请选择导入方式：</p>
            <div class="import-action-buttons">
              <button
                class="import-action-btn"
                :class="{ active: importAction === 'merge' }"
                @click="importAction = 'merge'"
              >
                <strong>合并</strong>
                <small>跳过重复，保留现有</small>
              </button>
              <button
                class="import-action-btn"
                :class="{ active: importAction === 'overwrite' }"
                @click="importAction = 'overwrite'"
              >
                <strong>覆盖</strong>
                <small>清空现有，全部替换</small>
              </button>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" @click="resetImport" :disabled="isImporting">取消</button>
          <button
            v-if="isEncryptedBackup"
            class="btn-primary"
            @click="decryptAndImport"
            :disabled="isImporting || !importPassword"
          >
            {{ isImporting ? '导入中...' : '解密并导入' }}
          </button>
          <button
            v-else
            class="btn-primary"
            @click="performImport"
            :disabled="isImporting"
          >
            {{ isImporting ? '导入中...' : '确认导入' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 32px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 600;
}

.page-content {
  flex: 1;
  padding: 24px 32px;
  overflow-y: auto;
}

.backup-sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
  margin-bottom: 24px;
}

.backup-section {
  background: #ffffff;
  padding: 32px;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  text-align: center;
}

.section-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 16px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.section-icon.export {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.section-icon.import {
  background: rgba(79, 70, 229, 0.1);
  color: #4f46e5;
}

.backup-section h2 {
  font-size: 18px;
  margin-bottom: 8px;
}

.backup-section p {
  font-size: 14px;
  color: #64748b;
  margin-bottom: 20px;
}

.export-password-input {
  margin-bottom: 16px;
}

.export-password-input label {
  display: block;
  font-size: 13px;
  color: #64748b;
  margin-bottom: 6px;
}

.backup-warning {
  display: flex;
  gap: 12px;
  background: rgba(245, 158, 11, 0.1);
  padding: 16px 20px;
  border-radius: 8px;
  color: #f59e0b;
}

.backup-warning svg {
  flex-shrink: 0;
  margin-top: 2px;
}

.backup-warning strong {
  display: block;
  margin-bottom: 4px;
}

.backup-warning p {
  font-size: 13px;
  opacity: 0.9;
}

/* Modal */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
}

.modal-content {
  position: relative;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  width: 90%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #e2e8f0;
}

.modal-header h3 {
  font-size: 18px;
  font-weight: 600;
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: #94a3b8;
}

.modal-close:hover {
  background: #f8fafc;
  color: #1e293b;
}

.modal-body {
  padding: 20px;
}

.modal-text {
  font-size: 14px;
  color: #1e293b;
  margin-bottom: 16px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid #e2e8f0;
}

/* Backup Info */
.backup-info {
  display: flex;
  gap: 24px;
  padding: 12px 16px;
  background: #f8fafc;
  border-radius: 8px;
  margin-bottom: 16px;
}

.backup-info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.backup-info-label {
  font-size: 12px;
  color: #64748b;
}

.backup-info-value {
  font-size: 14px;
  font-weight: 500;
  color: #1e293b;
}

/* Decrypt Section */
.decrypt-section {
  text-align: center;
  padding: 16px;
  background: #f8fafc;
  border-radius: 8px;
  margin-bottom: 16px;
}

.decrypt-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  background: #4f46e5;
  border-radius: 50%;
  margin-bottom: 12px;
  color: white;
}

.decrypt-title {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 4px;
}

.decrypt-desc {
  font-size: 13px;
  color: #64748b;
  margin-bottom: 12px;
}

.decrypt-section .form-input {
  text-align: center;
}

/* Import Action */
.import-action {
  margin-bottom: 16px;
}

.import-action-label {
  font-size: 14px;
  color: #1e293b;
  margin-bottom: 8px;
}

.import-action-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.import-action-btn {
  padding: 12px 16px;
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: all 0.2s;
}

.import-action-btn strong {
  display: block;
  font-size: 14px;
  color: #1e293b;
}

.import-action-btn small {
  display: block;
  font-size: 12px;
  color: #94a3b8;
  margin-top: 4px;
}

.import-action-btn.active {
  border-color: #4f46e5;
  background: rgba(79, 70, 229, 0.05);
}

.import-action-btn.active strong {
  color: #4f46e5;
}

/* Form Elements */
.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 14px;
  background: #ffffff;
}

.form-input:focus {
  outline: none;
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

.form-error {
  font-size: 13px;
  color: #ef4444;
  margin-top: 8px;
}

/* Buttons */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: #4f46e5;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover {
  background: #4338ca;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: #ffffff;
  color: #1e293b;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: #f8fafc;
  border-color: #4f46e5;
  color: #4f46e5;
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>