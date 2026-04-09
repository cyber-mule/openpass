/**
 * 自动备份管理 Composable
 */

import { ref } from 'vue';

export interface BackupSettings {
  enableAutoBackup: boolean;
  backupFrequency: 'daily' | 'weekly' | 'monthly';
  enableLocalSnapshot: boolean;
  enableDirectoryBackup: boolean;
  backupDirectory: string;
  lastBackupTime: string | null;
}

export function useAutoBackup() {
  const settings = ref<BackupSettings>({
    enableAutoBackup: false,
    backupFrequency: 'weekly',
    enableLocalSnapshot: true,
    enableDirectoryBackup: false,
    backupDirectory: '',
    lastBackupTime: null
  });

  async function loadSettings(): Promise<BackupSettings> {
    const result = await chrome.storage.local.get([
      'enableAutoBackup',
      'backupFrequency',
      'enableLocalSnapshot',
      'enableDirectoryBackup',
      'backupDirectory',
      'lastBackupTime'
    ]);

    settings.value = {
      enableAutoBackup: result.enableAutoBackup || false,
      backupFrequency: result.backupFrequency || 'weekly',
      enableLocalSnapshot: result.enableLocalSnapshot !== false,
      enableDirectoryBackup: result.enableDirectoryBackup || false,
      backupDirectory: result.backupDirectory || '',
      lastBackupTime: result.lastBackupTime || null
    };

    return settings.value;
  }

  async function saveSettings(newSettings: Partial<BackupSettings>) {
    settings.value = { ...settings.value, ...newSettings };

    await chrome.storage.local.set({
      enableAutoBackup: settings.value.enableAutoBackup,
      backupFrequency: settings.value.backupFrequency,
      enableLocalSnapshot: settings.value.enableLocalSnapshot,
      enableDirectoryBackup: settings.value.enableDirectoryBackup,
      backupDirectory: settings.value.backupDirectory,
      lastBackupTime: settings.value.lastBackupTime
    });
  }

  async function getSettings() {
    return await chrome.storage.local.get([
      'enableAutoBackup',
      'enableLocalSnapshot',
      'enableDirectoryBackup',
      'encryptedSecrets',
      'secrets'
    ]);
  }

  async function triggerChangeBackup(secrets: any[], options: { password?: string } = {}) {
    if (!settings.value.enableLocalSnapshot) return;

    const result = await chrome.storage.local.get(['backupSnapshots']);
    let snapshots = result.backupSnapshots || [];

    const backupData = {
      format: 'openpass-backup',
      formatVersion: 1,
      appVersion: chrome.runtime.getManifest().version,
      exportTime: new Date().toISOString(),
      count: secrets.length,
      encrypted: !!options.password,
      secrets: options.password ? undefined : secrets
    };

    if (options.password) {
      // 加密逻辑由调用者处理
      backupData.encryptedData = options.password;
    } else {
      backupData.secrets = secrets;
    }

    snapshots.unshift({
      data: backupData,
      timestamp: new Date().toISOString(),
      count: backupData.count
    });

    // 保留最近 5 个
    if (snapshots.length > 5) {
      snapshots = snapshots.slice(0, 5);
    }

    await chrome.storage.local.set({
      backupSnapshots: snapshots,
      lastBackupTime: new Date().toISOString()
    });
  }

  async function getBackupSnapshots() {
    const result = await chrome.storage.local.get(['backupSnapshots']);
    return result.backupSnapshots || [];
  }

  return {
    settings,
    loadSettings,
    saveSettings,
    getSettings,
    triggerChangeBackup,
    getBackupSnapshots
  };
}
