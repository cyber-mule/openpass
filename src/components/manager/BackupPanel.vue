<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSecretStore, type Secret } from '@/stores/secrets';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/utils/error';
import { showToast } from '@/utils/ui';
import {
  type BackupData,
  buildSecretIdentity,
  checkBackupCompatibility,
  createBackupData,
  decryptBackupData,
  getBackupEncryptionSettings,
  migrateBackupData,
  resolveStoredBackupPassword,
  validateBackupData
} from '@/utils/backup';

const secretStore = useSecretStore();
const authStore = useAuthStore();

type ImportAction = 'skip' | 'overwrite' | 'both';
type ImportBackupData = BackupData<Secret>;

const exportPassword = ref('');
const isExporting = ref(false);

const isReadingFile = ref(false);
const pendingImportData = ref<ImportBackupData | null>(null);
const isEncryptedBackup = ref(false);
const importPassword = ref('');
const importPasswordError = ref('');
const showImportModal = ref(false);
const isImporting = ref(false);
const importAction = ref<ImportAction>('skip');
const compatibilityHint = ref('');

const enableBackupEncryption = ref(false);
const useMasterPasswordForBackup = ref(true);

const backupInfo = computed(() => {
  if (!pendingImportData.value) {
    return null;
  }

  return {
    version: pendingImportData.value.appVersion || '未知',
    exportTime: pendingImportData.value.exportTime
      ? new Date(pendingImportData.value.exportTime).toLocaleString('zh-CN')
      : '-',
    count: pendingImportData.value.count || pendingImportData.value.secrets?.length || 0
  };
});

onMounted(async () => {
  const result = await getBackupEncryptionSettings();
  enableBackupEncryption.value = result.enableBackupEncryption;
  useMasterPasswordForBackup.value = result.useMasterPasswordForBackup;
});

async function handleExport() {
  if (secretStore.secrets.length === 0) {
    showToast('没有可导出的密钥', 'warning');
    return;
  }

  isExporting.value = true;

  try {
    let password: string | undefined;

    if (enableBackupEncryption.value) {
      const encryptionSettings = await getBackupEncryptionSettings();

      if (exportPassword.value) {
        password = exportPassword.value;
      } else {
        password = await resolveStoredBackupPassword(authStore.sessionKey, encryptionSettings);
      }

      if (!password) {
        showToast(
          encryptionSettings.useMasterPasswordForBackup
            ? '请先验证主密码'
            : '请先在设置页保存备份密码，或在此处临时输入',
          'warning'
        );
        return;
      }
    }

    const backupData = await createBackupData(secretStore.secrets, password);
    const blob = new Blob([JSON.stringify(backupData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const suffix = password ? '-encrypted' : '';
    const filename = `openpass-backup-${new Date().toISOString().split('T')[0]}${suffix}.json`;

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);

    showToast(
      `已导出 ${secretStore.secrets.length} 个密钥${password ? '（已加密）' : ''}`,
      'success'
    );
    exportPassword.value = '';
  } catch (error) {
    showToast(`导出失败: ${getErrorMessage(error)}`, 'error');
  } finally {
    isExporting.value = false;
  }
}

function triggerImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = handleFileSelect;
  input.click();
}

async function handleFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) {
    return;
  }

  isReadingFile.value = true;

  try {
    const content = await file.text();
    const validation = validateBackupData<Secret>(JSON.parse(content));

    if (!validation.valid || !validation.data) {
      showToast(validation.error || '无法识别的备份格式', 'error');
      return;
    }

    const compatibility = checkBackupCompatibility(validation.data.appVersion || '0.0.0');
    if (!compatibility.compatible) {
      showToast(compatibility.message, 'error');
      return;
    }

    let backupData = validation.data;
    compatibilityHint.value = compatibility.level === 'warning' ? compatibility.message : '';

    if (compatibility.level === 'warning' && !validation.encrypted) {
      backupData = migrateBackupData(backupData);
    }

    pendingImportData.value = backupData;
    isEncryptedBackup.value = validation.encrypted === true;
    showImportModal.value = true;
    importPassword.value = '';
    importPasswordError.value = '';
    importAction.value = 'skip';
  } catch {
    showToast('读取文件失败', 'error');
  } finally {
    isReadingFile.value = false;
  }
}

function normalizeImportedSecret(secret: Secret): Secret {
  return {
    ...secret,
    id: secret.id || crypto.randomUUID(),
    secret: String(secret.secret || '').trim().toUpperCase().replace(/\s/g, ''),
    site: String(secret.site || '').trim().toLowerCase(),
    digits: typeof secret.digits === 'number' ? secret.digits : 6
  };
}

async function getImportPasswordCandidates() {
  const manualPassword = importPassword.value.trim();
  if (manualPassword) {
    return [{ password: manualPassword, source: 'manual' as const }];
  }

  const candidates: Array<{ password: string; source: 'session' | 'stored' }> = [];

  if (authStore.sessionKey) {
    candidates.push({ password: authStore.sessionKey, source: 'session' });
  }

  const encryptionSettings = await getBackupEncryptionSettings();
  const storedPassword = await resolveStoredBackupPassword(authStore.sessionKey, encryptionSettings);

  if (storedPassword && storedPassword !== authStore.sessionKey) {
    candidates.push({ password: storedPassword, source: 'stored' });
  }

  return candidates;
}

async function decryptAndImport() {
  if (!pendingImportData.value) {
    importPasswordError.value = '备份数据无效';
    return;
  }

  isImporting.value = true;
  importPasswordError.value = '';

  try {
    const candidates = await getImportPasswordCandidates();
    if (candidates.length === 0) {
      importPasswordError.value = authStore.sessionKey
        ? '请输入该备份对应的加密密码'
        : '请输入备份密码，或先重新验证主密码';
      isImporting.value = false;
      return;
    }

    let decryptedSecrets: Secret[] | null = null;
    let lastError: unknown = null;

    for (const candidate of candidates) {
      try {
        decryptedSecrets = await decryptBackupData(pendingImportData.value, candidate.password);
        break;
      } catch (error) {
        lastError = error;
        if (candidate.source === 'manual') {
          break;
        }
      }
    }

    if (!decryptedSecrets) {
      importPasswordError.value = importPassword.value.trim()
        ? getErrorMessage(lastError, '解密失败，请检查备份密码是否正确')
        : authStore.sessionKey
          ? '当前主密码或已保存的备份密码无法解密该备份，请输入该备份对应的密码'
          : '请输入该备份对应的加密密码';
      isImporting.value = false;
      return;
    }

    let decryptedBackup: ImportBackupData = {
      ...pendingImportData.value,
      encrypted: false,
      encryptedData: undefined,
      secrets: decryptedSecrets,
      count: decryptedSecrets.length
    };

    const compatibility = checkBackupCompatibility(decryptedBackup.appVersion || '0.0.0');
    if (!compatibility.compatible) {
      importPasswordError.value = compatibility.message;
      isImporting.value = false;
      return;
    }

    compatibilityHint.value = compatibility.level === 'warning' ? compatibility.message : '';
    if (compatibility.level === 'warning') {
      decryptedBackup = migrateBackupData(decryptedBackup);
    }

    pendingImportData.value = decryptedBackup;
    isEncryptedBackup.value = false;
    await performImport();
  } catch (error) {
    importPasswordError.value = getErrorMessage(error, '解密失败，请检查备份密码是否正确');
    isImporting.value = false;
  }
}

async function performImport() {
  const secretsToImport = pendingImportData.value?.secrets;

  if (!Array.isArray(secretsToImport) || secretsToImport.length === 0) {
    showToast('备份数据无效或为空', 'error');
    resetImport();
    return;
  }

  isImporting.value = true;

  try {
    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const secret of secretsToImport.map(normalizeImportedSecret)) {
      const existingIndex = secretStore.secrets.findIndex(
        (item) => buildSecretIdentity(item) === buildSecretIdentity(secret)
      );

      if (existingIndex === -1) {
        secretStore.secrets.push({
          ...secret,
          importedAt: new Date().toISOString()
        });
        addedCount += 1;
        continue;
      }

      if (importAction.value === 'skip') {
        skippedCount += 1;
        continue;
      }

      if (importAction.value === 'overwrite') {
        secretStore.secrets[existingIndex] = {
          ...secretStore.secrets[existingIndex],
          ...secret,
          id: secretStore.secrets[existingIndex].id,
          createdAt: secretStore.secrets[existingIndex].createdAt,
          updatedAt: new Date().toISOString()
        };
        updatedCount += 1;
        continue;
      }

      secretStore.secrets.push({
        ...secret,
        id: crypto.randomUUID(),
        site: `${secret.site}-${crypto.randomUUID().slice(0, 8)}`,
        importedAt: new Date().toISOString()
      });
      addedCount += 1;
    }

    await secretStore.saveSecrets({ triggerSnapshot: true });
    resetImport();

    const messages = [];
    if (addedCount > 0) messages.push(`新增 ${addedCount} 个`);
    if (updatedCount > 0) messages.push(`更新 ${updatedCount} 个`);
    if (skippedCount > 0) messages.push(`跳过 ${skippedCount} 个`);

    showToast(
      messages.length > 0 ? `导入完成：${messages.join('，')}` : '没有可导入的密钥',
      'success'
    );
  } catch (error) {
    showToast(`导入失败: ${getErrorMessage(error)}`, 'error');
  } finally {
    isImporting.value = false;
  }
}

function resetImport() {
  showImportModal.value = false;
  pendingImportData.value = null;
  isEncryptedBackup.value = false;
  importPassword.value = '';
  importPasswordError.value = '';
  compatibilityHint.value = '';
}
</script>

<template>
  <header class="page-header">
    <h1>备份恢复</h1>
  </header>

  <div class="page-content">
    <div class="backup-sections">
      <section class="backup-section">
        <div class="section-icon export">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
        </div>
        <h2>导出备份</h2>
        <p>将当前全部密钥导出为 JSON 备份文件。</p>

        <div v-if="enableBackupEncryption && !useMasterPasswordForBackup" class="export-password-input">
          <label>备份密码</label>
          <input
            v-model="exportPassword"
            type="password"
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

      <section class="backup-section">
        <div class="section-icon import">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </div>
        <h2>导入备份</h2>
        <p>支持导入旧版备份、未加密备份和加密备份。</p>
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

    <div class="backup-warning">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
      <div>
        <strong>安全提示</strong>
        <p>备份文件包含敏感密钥，请妥善保管，不要上传到公共位置。</p>
      </div>
    </div>

    <div v-if="showImportModal" class="modal" @click="resetImport">
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

          <p v-if="compatibilityHint" class="compatibility-hint">
            {{ compatibilityHint }}
          </p>

          <p class="modal-text">
            检测到备份包含 <strong>{{ backupInfo?.count || 0 }}</strong> 个密钥，
            当前已有 <strong>{{ secretStore.secrets.length }}</strong> 个密钥。
          </p>

          <div v-if="isEncryptedBackup" class="decrypt-section">
            <div class="decrypt-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <p class="decrypt-title">此备份已加密</p>
            <p class="decrypt-desc">将优先尝试当前主密码或已保存的备份密码；失败时再手动输入。</p>
            <input
              v-model="importPassword"
              type="password"
              class="form-input"
              placeholder="输入备份密码（可留空）"
            >
            <p v-if="importPasswordError" class="form-error">{{ importPasswordError }}</p>
          </div>

          <div class="import-action">
            <p class="import-action-label">选择导入策略</p>
            <div class="import-action-buttons">
              <button
                class="import-action-btn"
                :class="{ active: importAction === 'skip' }"
                @click="importAction = 'skip'"
              >
                <strong>跳过重复</strong>
                <small>保留现有数据，只导入新密钥</small>
              </button>
              <button
                class="import-action-btn"
                :class="{ active: importAction === 'overwrite' }"
                @click="importAction = 'overwrite'"
              >
                <strong>覆盖重复</strong>
                <small>匹配到重复项时用备份内容覆盖</small>
              </button>
              <button
                class="import-action-btn"
                :class="{ active: importAction === 'both' }"
                @click="importAction = 'both'"
              >
                <strong>全部保留</strong>
                <small>重复项也作为新记录导入</small>
              </button>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" :disabled="isImporting" @click="resetImport">取消</button>
          <button
            v-if="isEncryptedBackup"
            class="btn-primary"
            :disabled="isImporting"
            @click="decryptAndImport"
          >
            {{ isImporting ? '导入中...' : '解密并导入' }}
          </button>
          <button
            v-else
            class="btn-primary"
            :disabled="isImporting"
            @click="performImport"
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
  text-align: left;
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

.modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.modal-content {
  position: relative;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  width: 90%;
  max-width: 520px;
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

.compatibility-hint {
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
  font-size: 13px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid #e2e8f0;
}

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
  color: #ffffff;
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

.import-action {
  margin-bottom: 8px;
}

.import-action-label {
  font-size: 14px;
  color: #1e293b;
  margin-bottom: 8px;
}

.import-action-buttons {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.import-action-btn {
  padding: 12px 16px;
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
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

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: #4f46e5;
  color: #ffffff;
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

@media (max-width: 900px) {
  .backup-sections {
    grid-template-columns: 1fr;
  }

  .import-action-buttons {
    grid-template-columns: 1fr;
  }

  .backup-info {
    flex-direction: column;
    gap: 12px;
  }
}
</style>
