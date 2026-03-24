/**
 * OpenPass - 自动备份模块
 * 处理定时备份、本地快照和目录备份
 */

class AutoBackupManager {
  constructor() {
    this.alarmName = 'openpass-auto-backup';
    this.maxSnapshots = 5;
  }

  /**
   * 获取自动备份设置
   */
  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([
        'enableAutoBackup',
        'backupFrequency',
        'enableLocalSnapshot',
        'enableDirectoryBackup',
        'backupDirectoryHandle',
        'lastBackupTime',
        'nextBackupTime'
      ], (result) => {
        resolve({
          enabled: result.enableAutoBackup || false,
          frequency: result.backupFrequency || 'weekly',
          localSnapshot: result.enableLocalSnapshot !== false,
          directoryBackup: result.enableDirectoryBackup || false,
          directoryHandle: result.backupDirectoryHandle || null,
          lastBackupTime: result.lastBackupTime || null,
          nextBackupTime: result.nextBackupTime || null
        });
      });
    });
  }

  /**
   * 保存自动备份设置
   */
  async saveSettings(settings) {
    const data = {};
    if (settings.enabled !== undefined) data.enableAutoBackup = settings.enabled;
    if (settings.frequency !== undefined) data.backupFrequency = settings.frequency;
    if (settings.localSnapshot !== undefined) data.enableLocalSnapshot = settings.localSnapshot;
    if (settings.directoryBackup !== undefined) data.enableDirectoryBackup = settings.directoryBackup;
    if (settings.directoryHandle !== undefined) data.backupDirectoryHandle = settings.directoryHandle;
    if (settings.lastBackupTime !== undefined) data.lastBackupTime = settings.lastBackupTime;
    if (settings.nextBackupTime !== undefined) data.nextBackupTime = settings.nextBackupTime;

    return new Promise((resolve) => {
      chrome.storage.local.set(data, resolve);
    });
  }

  /**
   * 获取备份间隔（毫秒）
   */
  getBackupInterval(frequency) {
    switch (frequency) {
      case 'daily':
        return 24 * 60 * 60 * 1000; // 1 天
      case 'weekly':
        return 7 * 24 * 60 * 60 * 1000; // 7 天
      case 'monthly':
        return 30 * 24 * 60 * 60 * 1000; // 30 天
      default:
        return 7 * 24 * 60 * 60 * 1000;
    }
  }

  /**
   * 检查是否需要备份
   */
  async checkBackupNeeded() {
    const settings = await this.getSettings();

    if (!settings.enabled) {
      return { needed: false, reason: 'disabled' };
    }

    if (!settings.lastBackupTime) {
      return { needed: true, reason: 'never' };
    }

    const interval = this.getBackupInterval(settings.frequency);
    const lastBackup = new Date(settings.lastBackupTime);
    const now = new Date();
    const elapsed = now - lastBackup;

    if (elapsed >= interval) {
      const daysOverdue = Math.floor((elapsed - interval) / (24 * 60 * 60 * 1000));
      return {
        needed: true,
        reason: 'overdue',
        lastBackup: settings.lastBackupTime,
        daysOverdue
      };
    }

    return {
      needed: false,
      reason: 'not_due',
      lastBackup: settings.lastBackupTime,
      nextBackup: new Date(lastBackup.getTime() + interval).toISOString()
    };
  }

  /**
   * 设置定时器（备用，浏览器持续运行时使用）
   */
  async setupAlarm(frequency) {
    // 清除现有定时器
    await chrome.alarms.clear(this.alarmName);

    // 设置一个较短的检查间隔（每小时检查一次）
    chrome.alarms.create(this.alarmName, {
      delayInMinutes: 60,
      periodInMinutes: 60
    });
  }

  /**
   * 清除定时器
   */
  async clearAlarm() {
    await chrome.alarms.clear(this.alarmName);
    await this.saveSettings({ nextBackupTime: null });
  }

  /**
   * 保存本地快照
   */
  async saveSnapshot(backupData) {
    const result = await chrome.storage.local.get(['backupSnapshots']);
    let snapshots = result.backupSnapshots || [];

    // 添加新快照
    snapshots.unshift({
      data: backupData,
      timestamp: new Date().toISOString(),
      count: backupData.count
    });

    // 保留最近 N 个
    if (snapshots.length > this.maxSnapshots) {
      snapshots = snapshots.slice(0, this.maxSnapshots);
    }

    await chrome.storage.local.set({ backupSnapshots: snapshots });
    return snapshots;
  }

  /**
   * 获取本地快照列表
   */
  async getSnapshots() {
    const result = await chrome.storage.local.get(['backupSnapshots']);
    return result.backupSnapshots || [];
  }

  /**
   * 删除本地快照
   */
  async deleteSnapshot(index) {
    const result = await chrome.storage.local.get(['backupSnapshots']);
    let snapshots = result.backupSnapshots || [];

    if (index >= 0 && index < snapshots.length) {
      snapshots.splice(index, 1);
      await chrome.storage.local.set({ backupSnapshots: snapshots });
    }

    return snapshots;
  }

  /**
   * 清除所有快照
   */
  async clearSnapshots() {
    await chrome.storage.local.set({ backupSnapshots: [] });
  }

  /**
   * 选择备份目录
   */
  async selectDirectory() {
    try {
      // 检查是否支持 File System Access API
      if (!('showDirectoryPicker' in window)) {
        return { success: false, error: '浏览器不支持此功能，请使用 Chrome 86 或更高版本' };
      }

      const handle = await window.showDirectoryPicker({
        mode: 'readwrite',
        id: 'openpass-backup-dir'
      });

      // 存储目录句柄
      await this.saveHandle(handle);

      return { success: true, name: handle.name, handle };
    } catch (error) {
      if (error.name === 'AbortError') {
        return { success: false, error: '已取消选择' };
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * 存储目录句柄到 IndexedDB
   */
  async saveHandle(handle) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('OpenPassBackupDB', 1);

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('directoryHandles')) {
          db.createObjectStore('directoryHandles');
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction('directoryHandles', 'readwrite');
        const store = transaction.objectStore('directoryHandles');

        store.put(handle, 'backupDirectory');

        transaction.oncomplete = () => resolve(handle.name);
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }

  /**
   * 获取存储的目录句柄
   */
  async getStoredHandle() {
    return new Promise((resolve) => {
      const request = indexedDB.open('OpenPassBackupDB', 1);

      request.onerror = () => resolve(null);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('directoryHandles')) {
          db.createObjectStore('directoryHandles');
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('directoryHandles')) {
          resolve(null);
          return;
        }

        const transaction = db.transaction('directoryHandles', 'readonly');
        const store = transaction.objectStore('directoryHandles');
        const getRequest = store.get('backupDirectory');

        getRequest.onsuccess = () => resolve(getRequest.result);
        getRequest.onerror = () => resolve(null);
      };
    });
  }

  /**
   * 检查目录权限状态
   * @returns {'granted'|'denied'|'prompt'|'no-handle'}
   */
  async checkPermissionStatus() {
    const handle = await this.getStoredHandle();

    if (!handle) {
      return 'no-handle';
    }

    try {
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      return permission; // 'granted', 'denied', 'prompt'
    } catch (error) {
      console.error('检查权限失败:', error);
      return 'denied';
    }
  }

  /**
   * 请求目录权限
   */
  async requestPermission() {
    const handle = await this.getStoredHandle();

    if (!handle) {
      return { success: false, error: '未选择备份目录' };
    }

    try {
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      return { success: permission === 'granted', permission };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取目录信息和权限状态
   */
  async getDirectoryInfo() {
    const handle = await this.getStoredHandle();

    if (!handle) {
      return {
        hasHandle: false,
        name: null,
        permission: 'no-handle'
      };
    }

    const permission = await this.checkPermissionStatus();

    return {
      hasHandle: true,
      name: handle.name,
      permission
    };
  }

  /**
   * 写入备份文件到目录
   */
  async writeToDirectory(backupData) {
    try {
      const handle = await this.getStoredHandle();

      if (!handle) {
        return { success: false, error: '未选择备份目录', needAuth: false };
      }

      // 检查权限
      let permission = await handle.queryPermission({ mode: 'readwrite' });

      if (permission === 'prompt') {
        // 尝试请求权限
        permission = await handle.requestPermission({ mode: 'readwrite' });
      }

      if (permission !== 'granted') {
        return {
          success: false,
          error: permission === 'denied' ? '权限被拒绝，请在设置中重新授权' : '需要授权写入权限',
          needAuth: true
        };
      }

      // 生成文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `openpass-backup-${timestamp}.json`;

      // 创建文件
      const fileHandle = await handle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();

      // 写入数据
      const json = JSON.stringify(backupData, null, 2);
      await writable.write(json);
      await writable.close();

      return { success: true, filename };
    } catch (error) {
      console.error('写入备份文件失败:', error);

      // 判断是否是权限问题
      if (error.name === 'NotAllowedError') {
        return { success: false, error: '权限不足，请重新授权', needAuth: true };
      }

      return { success: false, error: error.message };
    }
  }

  /**
   * 清除目录句柄
   */
  async clearHandle() {
    return new Promise((resolve) => {
      const request = indexedDB.open('OpenPassBackupDB', 1);

      request.onsuccess = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('directoryHandles')) {
          resolve();
          return;
        }

        const transaction = db.transaction('directoryHandles', 'readwrite');
        const store = transaction.objectStore('directoryHandles');
        store.delete('backupDirectory');

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
      };

      request.onerror = () => resolve();
    });
  }

  /**
   * 执行自动备份
   */
  async performBackup(secrets, options = {}) {
    const settings = await this.getSettings();
    const results = {
      snapshot: null,
      directory: null,
      timestamp: new Date().toISOString()
    };

    // 创建备份数据
    const backupData = await backupManager.createBackup(secrets, {
      password: options.password
    });

    // 保存本地快照
    if (settings.localSnapshot) {
      const snapshots = await this.saveSnapshot(backupData);
      results.snapshot = {
        success: true,
        count: snapshots.length
      };
    }

    // 写入目录
    if (settings.directoryBackup) {
      const dirResult = await this.writeToDirectory(backupData);
      results.directory = dirResult;
    }

    // 更新备份时间
    await this.saveSettings({ lastBackupTime: results.timestamp });

    // 设置下次备份
    if (settings.enabled) {
      await this.setupAlarm(settings.frequency);
    }

    return results;
  }

  /**
   * 格式化时间显示
   */
  formatTime(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

// 导出
const autoBackupManager = new AutoBackupManager();