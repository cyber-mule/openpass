/**
 * 自动备份管理 Composable
 * 处理定时备份、本地快照和目录备份
 */

import { ref } from 'vue';
import CryptoUtils from '@/utils/crypto';

export interface BackupSettings {
  enableAutoBackup: boolean;
  backupFrequency: 'daily' | 'weekly' | 'monthly';
  enableLocalSnapshot: boolean;
  enableDirectoryBackup: boolean;
  backupDirectory: string;
  lastBackupTime: string | null;
  nextBackupTime: string | null;
}

export interface DirectoryInfo {
  hasHandle: boolean;
  name: string | null;
  permission: 'granted' | 'prompt' | 'denied' | 'no-handle';
}

const DB_NAME = 'OpenPassBackupDB';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const MAX_SNAPSHOTS = 5;

export function useAutoBackup() {
  const settings = ref<BackupSettings>({
    enableAutoBackup: false,
    backupFrequency: 'weekly',
    enableLocalSnapshot: true,
    enableDirectoryBackup: false,
    backupDirectory: '',
    lastBackupTime: null,
    nextBackupTime: null
  });

  async function loadSettings(): Promise<BackupSettings> {
    const result = await chrome.storage.local.get([
      'enableAutoBackup',
      'backupFrequency',
      'enableLocalSnapshot',
      'enableDirectoryBackup',
      'backupDirectory',
      'lastBackupTime',
      'nextBackupTime'
    ]);

    settings.value = {
      enableAutoBackup: result.enableAutoBackup || false,
      backupFrequency: result.backupFrequency || 'weekly',
      enableLocalSnapshot: result.enableLocalSnapshot !== false,
      enableDirectoryBackup: result.enableDirectoryBackup || false,
      backupDirectory: result.backupDirectory || '',
      lastBackupTime: result.lastBackupTime || null,
      nextBackupTime: result.nextBackupTime || null
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
      lastBackupTime: settings.value.lastBackupTime,
      nextBackupTime: settings.value.nextBackupTime
    });
  }

  function getBackupInterval(frequency: string): number {
    switch (frequency) {
      case 'daily':
        return 24 * 60 * 60 * 1000;
      case 'weekly':
        return 7 * 24 * 60 * 60 * 1000;
      case 'monthly':
        return 30 * 24 * 60 * 60 * 1000;
      default:
        return 7 * 24 * 60 * 60 * 1000;
    }
  }

  // IndexedDB 操作
  async function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  }

  async function saveHandle(handle: FileSystemDirectoryHandle) {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(handle, 'backupDirectory');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async function getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get('backupDirectory');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  async function removeHandle() {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete('backupDirectory');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // 目录选择
  async function selectDirectory(): Promise<{ success: boolean; name?: string; error?: string }> {
    try {
      if (!('showDirectoryPicker' in window)) {
        return { success: false, error: '浏览器不支持此功能，请使用 Chrome 86 或更高版本' };
      }

      const handle = await window.showDirectoryPicker({
        mode: 'readwrite',
        id: 'openpass-backup-dir'
      });

      await saveHandle(handle);
      await chrome.storage.local.set({ backupDirectory: handle.name });
      settings.value.backupDirectory = handle.name;

      return { success: true, name: handle.name };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { success: false, error: '已取消选择' };
      }
      return { success: false, error: error.message };
    }
  }

  // 获取目录信息
  async function getDirectoryInfo(): Promise<DirectoryInfo> {
    const handle = await getStoredHandle();

    if (!handle) {
      return {
        hasHandle: false,
        name: null,
        permission: 'no-handle'
      };
    }

    let permission: 'granted' | 'prompt' | 'denied' = 'prompt';
    try {
      const status = await handle.queryPermission({ mode: 'readwrite' });
      permission = status as 'granted' | 'prompt' | 'denied';
    } catch {
      permission = 'prompt';
    }

    return {
      hasHandle: true,
      name: handle.name,
      permission
    };
  }

  // 请求权限
  async function requestPermission(): Promise<{ success: boolean; error?: string }> {
    const handle = await getStoredHandle();
    if (!handle) {
      return { success: false, error: '未选择备份目录' };
    }

    try {
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      return { success: permission === 'granted' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // 写入备份文件到目录
  async function writeToDirectory(backupData: any): Promise<{ success: boolean; filename?: string; error?: string; needAuth?: boolean }> {
    try {
      const handle = await getStoredHandle();

      if (!handle) {
        return { success: false, error: '未选择备份目录', needAuth: false };
      }

      // 检查权限
      let permission = await handle.queryPermission({ mode: 'readwrite' });

      if (permission === 'prompt') {
        permission = await handle.requestPermission({ mode: 'readwrite' });
      }

      if (permission !== 'granted') {
        return {
          success: false,
          error: permission === 'denied' ? '权限被拒绝，请重新选择目录' : '需要授权写入权限',
          needAuth: true
        };
      }

      // 生成文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const suffix = backupData.encrypted ? '-encrypted' : '';
      const filename = `openpass-backup-${timestamp}${suffix}.json`;

      // 创建文件
      const fileHandle = await handle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();

      const json = JSON.stringify(backupData, null, 2);
      await writable.write(json);
      await writable.close();

      return { success: true, filename };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // 保存本地快照
  async function saveSnapshot(backupData: any) {
    const result = await chrome.storage.local.get(['backupSnapshots']);
    let snapshots = result.backupSnapshots || [];

    snapshots.unshift({
      data: backupData,
      timestamp: new Date().toISOString(),
      count: backupData.count
    });

    if (snapshots.length > MAX_SNAPSHOTS) {
      snapshots = snapshots.slice(0, MAX_SNAPSHOTS);
    }

    await chrome.storage.local.set({ backupSnapshots: snapshots });
    return snapshots;
  }

  // 获取本地快照列表
  async function getSnapshots() {
    const result = await chrome.storage.local.get(['backupSnapshots']);
    return result.backupSnapshots || [];
  }

  // 创建备份数据
  async function createBackup(secrets: any[], options: { password?: string } = {}) {
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
      const encryptedData = await CryptoUtils.encrypt(
        JSON.stringify(secrets),
        options.password
      );
      backupData.secrets = undefined;
      (backupData as any).encryptedData = encryptedData;
    }

    return backupData;
  }

  // 执行完整备份
  async function performBackup(secrets: any[], options: { password?: string } = {}) {
    const backupData = await createBackup(secrets, options);
    const results: { snapshot: boolean; directory?: { success: boolean; filename?: string; error?: string; needAuth?: boolean } } = {
      snapshot: false,
      directory: undefined
    };

    // 保存本地快照
    if (settings.value.enableLocalSnapshot) {
      await saveSnapshot(backupData);
      results.snapshot = true;
    }

    // 写入目录
    if (settings.value.enableDirectoryBackup) {
      results.directory = await writeToDirectory(backupData);
    }

    // 更新备份时间
    const now = new Date().toISOString();
    const interval = getBackupInterval(settings.value.backupFrequency);
    const nextBackup = new Date(Date.now() + interval).toISOString();

    await saveSettings({
      lastBackupTime: now,
      nextBackupTime: nextBackup
    });

    return results;
  }

  return {
    settings,
    loadSettings,
    saveSettings,
    getBackupInterval,
    selectDirectory,
    getDirectoryInfo,
    requestPermission,
    writeToDirectory,
    saveSnapshot,
    getSnapshots,
    createBackup,
    performBackup,
    removeHandle
  };
}