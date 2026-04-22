import jsQR from 'jsqr';
import { TOTP } from 'otpauth';
import {
  createBackupData,
  getBackupEncryptionSettings,
  resolveStoredBackupPassword,
  saveBackupSnapshot
} from '@/utils/backup';

type BackupFrequency = 'daily' | 'weekly' | 'monthly';

interface StoredSecret {
  secret: string;
  site: string;
  name?: string;
  digits?: number;
}

type PendingSecret = StoredSecret;

interface SiteListItem {
  site: string;
}

const BACKUP_DB_NAME = 'OpenPassBackupDB';
const BACKUP_DB_VERSION = 1;
const BACKUP_HANDLE_STORE = 'handles';

export default defineBackground(() => {
  // SessionKey 内存缓存，供自动备份解密使用
  let cachedSessionKey: string | null = null;

  // 启动时自动修复 secrets 结构
  (async () => {
    const result = await chrome.storage.local.get<{
      secrets?: StoredSecret[];
      encryptedSecrets?: string;
    }>(['secrets', 'encryptedSecrets']);
    if (!Array.isArray(result.secrets)) {
      console.warn('[Background] secrets 格式异常，尝试修复');
      // 如果存在 encryptedSecrets，等待用户解锁后修复
      // 如果没有数据，则初始化为空数组
      if (!result.encryptedSecrets) {
        await chrome.storage.local.set({ secrets: [], sitesList: [] });
      }
    }
  })();

  // 创建右键菜单
  chrome.runtime.onInstalled.addListener((details) => {
    chrome.contextMenus.create({
      id: 'parseQRCode',
      title: '识别并添加',
      contexts: ['image']
    });

    // 创建自动备份定时器
    chrome.alarms.create('openpass-auto-backup', {
      delayInMinutes: 5,
      periodInMinutes: 60 // 每小时检查一次
    });

    // 首次安装时自动打开管理页面
    if (details.reason === 'install') {
      const url = chrome.runtime.getURL('options.html');
      chrome.tabs.create({ url });
    }
  });

  // 监听右键菜单点击
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'parseQRCode' && info.srcUrl) {
      const setupComplete = await checkSetupComplete();
      if (!setupComplete) {
        showNotification('请先设置主密码', '点击扩展图标开始设置');
        return;
      }

      try {
        const secret = await parseQRFromImageUrl(info.srcUrl);
      if (secret) {
          await storePendingSecret(secret, tab);
          chrome.action.openPopup();
        } else {
          showNotification('识别失败', '未能识别有效的 TOTP 密钥');
        }
      } catch (error) {
        console.error('解析 QR 码失败', error);
        showNotification('识别失败', '无法读取图片中的 QR 码');
      }
    }
  });

  async function checkSetupComplete(): Promise<boolean> {
    const result = await chrome.storage.local.get<{ isSetupComplete?: boolean }>(['isSetupComplete']);
    return result.isSetupComplete === true;
  }

  async function openBackupDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(BACKUP_HANDLE_STORE)) {
          db.createObjectStore(BACKUP_HANDLE_STORE);
        }
      };
    });
  }

  async function getStoredBackupHandle(): Promise<FileSystemDirectoryHandle | null> {
    const db = await openBackupDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(BACKUP_HANDLE_STORE, 'readonly');
      const store = transaction.objectStore(BACKUP_HANDLE_STORE);
      const request = store.get('backupDirectory');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  async function writeBackupToDirectory(backupData: unknown) {
    try {
      const handle = await getStoredBackupHandle();
      if (!handle) {
        return { success: false, error: '未选择备份目录', needAuth: false };
      }

      let permission = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
      if (permission === 'prompt') {
        permission = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
      }

      if (permission !== 'granted') {
        return {
          success: false,
          error: permission === 'denied' ? '权限被拒绝，请重新授权备份目录' : '需要授权写入权限',
          needAuth: true
        };
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const suffix =
        typeof backupData === 'object' && backupData !== null && 'encrypted' in backupData &&
        (backupData as { encrypted?: boolean }).encrypted
          ? '-encrypted'
          : '';
      const filename = `openpass-backup-${timestamp}${suffix}.json`;

      const fileHandle = await handle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(backupData, null, 2));
      await writable.close();

      return { success: true, filename };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '写入备份目录失败'
      };
    }
  }

  async function parseQRFromImageUrl(url: string) {
    try {
      let blob;

      if (url.startsWith('data:')) {
        const response = await fetch(url);
        blob = await response.blob();
      } else {
        const response = await fetch(url, { mode: 'cors' });
        blob = await response.blob();
      }

      const imageBitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('2D canvas context unavailable');
      }
      ctx.drawImage(imageBitmap, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });

      if (code && code.data) {
        return parseOTPAuthUrl(code.data);
      }
      return null;
    } catch (error) {
      console.error('解析 QR 码失败', error);
      throw error;
    }
  }

  function parseOTPAuthUrl(data: string) {
    if (/^[A-Z2-7]+=*$/i.test(data.trim())) {
      return {
        secret: data.trim().toUpperCase().replace(/\s/g, ''),
        site: '',
        name: ''
      };
    }

    if (data.startsWith('otpauth://')) {
      try {
        const url = new URL(data);
        const params = new URLSearchParams(url.search);
        const secret = params.get('secret');
        if (!secret) return null;

        const issuer = params.get('issuer') || '';
        const account = decodeURIComponent(url.pathname.split('/').pop() || '');

        let site = issuer;
        if (!site && account.includes(':')) {
          site = account.split(':')[0];
        }

        return {
          secret: secret.toUpperCase(),
          site: site.toLowerCase(),
          name: issuer || account.replace(/.*:/, '')
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  async function storePendingSecret(secret: PendingSecret, tab?: chrome.tabs.Tab) {
    let pageUrl = '';
    if (tab && tab.url) {
      pageUrl = tab.url;
    }

    if (!secret.site && pageUrl) {
      secret.site = pageUrl;
    }

    await chrome.storage.local.set({ pendingSecret: secret });
  }

  function showNotification(title: string, message: string) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message
    });
  }

  // 消息监听
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'generateCode') {
      (async () => {
        try {
          const totp = new TOTP({
            secret: request.secret,
            algorithm: 'SHA1',
            digits: request.digits || 6,
            period: 30
          });
          const code = totp.generate();
          const time = Math.floor(Date.now() / 1000);
          const remainingSeconds = 30 - (time % 30);
          sendResponse({ code, remainingSeconds });
        } catch (error) {
          sendResponse({ error: (error as Error).message });
        }
      })();
      return true;
    }

    // 缓存 sessionKey，供用户解锁时写入
    if (request.action === 'cacheSessionKey') {
      cachedSessionKey = request.sessionKey || null;
      sendResponse({ success: true });
      return true;
    }

    // 获取缓存的 sessionKey，供自动备份使用
    if (request.action === 'getCachedSessionKey') {
      sendResponse({ sessionKey: cachedSessionKey });
      return true;
    }

    if (request.action === 'checkSetup') {
      (async () => {
        const setupComplete = await checkSetupComplete();
        sendResponse({ setupComplete });
      })();
      return true;
    }

    if (request.action === 'getSecrets') {
      (async () => {
        try {
          const setupComplete = await checkSetupComplete();
          if (!setupComplete) {
            sendResponse({ error: 'not_setup' });
            return;
          }

          const result = await chrome.storage.local.get<{
            encryptedSecrets?: string;
            secrets?: StoredSecret[];
          }>(['encryptedSecrets', 'secrets']);

          // 优先尝试用缓存的 sessionKey 解密
          if (typeof result.encryptedSecrets === 'string' && cachedSessionKey) {
            const CryptoUtils = await import('../utils/crypto');
            const decrypted = await CryptoUtils.default.decrypt(result.encryptedSecrets, cachedSessionKey);
            const secrets = JSON.parse(decrypted);
            sendResponse({ secrets });
          } else if (typeof result.encryptedSecrets === 'string' && typeof request.sessionKey === 'string') {
            const CryptoUtils = await import('../utils/crypto');
            const decrypted = await CryptoUtils.default.decrypt(result.encryptedSecrets, request.sessionKey);
            const secrets = JSON.parse(decrypted);
            sendResponse({ secrets });
          } else if (Array.isArray(result.secrets)) {
            sendResponse({ secrets: result.secrets });
          } else {
            sendResponse({ secrets: [] });
          }
        } catch (error) {
          sendResponse({ error: (error as Error).message });
        }
      })();
      return true;
    }
  });

  // Badge 更新
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
      updateBadgeForTab(tabId, tab.url);
    }
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab && tab.url) {
        updateBadgeForTab(activeInfo.tabId, tab.url);
      }
    });
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.secrets || changes.encryptedSecrets || changes.sitesList)) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab?.url && typeof activeTab.id === 'number') {
          updateBadgeForTab(activeTab.id, activeTab.url);
        }
      });
    }
  });

  // 自动备份定时器
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'openpass-auto-backup') {
      await handleAutoBackup();
    }
  });

  async function handleAutoBackup() {
    try {
      const checkResult = await checkBackupNeeded();
      if (!checkResult.needed) return;

      const settings = await chrome.storage.local.get<{
        enableAutoBackup?: boolean;
        backupFrequency?: BackupFrequency;
        enableLocalSnapshot?: boolean;
        enableDirectoryBackup?: boolean;
        encryptedSecrets?: string;
        secrets?: StoredSecret[];
      }>([
        'enableAutoBackup',
        'backupFrequency',
        'enableLocalSnapshot',
        'enableDirectoryBackup',
        'encryptedSecrets',
        'secrets'
      ]);

      if (settings.enableAutoBackup !== true) return;

      let secrets: StoredSecret[] = [];
      
      // 如果存在加密密钥，尝试使用缓存的 sessionKey 解密
      if (typeof settings.encryptedSecrets === 'string') {
        if (!cachedSessionKey) {
          return; // 用户未解锁，跳过备份
        }
        
        try {
          const CryptoUtils = await import('../utils/crypto');
          const decrypted = await CryptoUtils.default.decrypt(
            settings.encryptedSecrets,
            cachedSessionKey
          );
          secrets = JSON.parse(decrypted);
        } catch (error) {
          console.error('OpenPass: 自动备份解密失败', error);
          return;
        }
      } else if (Array.isArray(settings.secrets)) {
        secrets = settings.secrets;
      }

      if (secrets.length === 0) return;

      const encryptionSettings = await getBackupEncryptionSettings();
      const backupPassword = await resolveStoredBackupPassword(
        cachedSessionKey,
        encryptionSettings
      );

      if (encryptionSettings.enableBackupEncryption && !backupPassword) {
        return;
      }

      const backupData = await createBackupData(secrets, backupPassword);
      let savedSnapshot = false;
      let directoryResult:
        | { success: boolean; filename?: string; error?: string; needAuth?: boolean }
        | undefined;

      if (settings.enableLocalSnapshot) {
        await saveBackupSnapshot(backupData);
        savedSnapshot = true;
      }

      if (settings.enableDirectoryBackup) {
        directoryResult = await writeBackupToDirectory(backupData);
      }

      if (!savedSnapshot && !directoryResult?.success) {
        if (directoryResult?.error) {
          showNotification('自动备份失败', directoryResult.error);
        }
        return;
      }

      const interval = {
        daily: 24 * 60 * 60 * 1000,
        weekly: 7 * 24 * 60 * 60 * 1000,
        monthly: 30 * 24 * 60 * 60 * 1000
      }[(settings.backupFrequency ?? 'weekly') as BackupFrequency] || 7 * 24 * 60 * 60 * 1000;
      const now = new Date();

      await chrome.storage.local.set({
        lastBackupTime: now.toISOString(),
        nextBackupTime: new Date(now.getTime() + interval).toISOString()
      });

      const messages = [];
      if (savedSnapshot) {
        messages.push(`已备份 ${secrets.length} 个密钥到本地快照`);
      }
      if (directoryResult?.success) {
        messages.push(`已写入 ${directoryResult.filename}`);
      }

      if (messages.length > 0) {
        showNotification('自动备份完成', messages.join('；'));
      }    } catch (error) {
      console.error('OpenPass: 自动备份失败', error);
      showNotification('自动备份失败', (error as Error).message);
    }
  }

  async function checkBackupNeeded() {
    const settings = await chrome.storage.local.get<{
      enableAutoBackup?: boolean;
      backupFrequency?: BackupFrequency;
      lastBackupTime?: string;
    }>([
      'enableAutoBackup',
      'backupFrequency',
      'lastBackupTime'
    ]);

    if (settings.enableAutoBackup !== true) {
      return { needed: false, reason: 'disabled' };
    }

    if (!settings.lastBackupTime) {
      return { needed: true, reason: 'never' };
    }

    const intervals: Record<BackupFrequency, number> = {
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000
    };

    const interval = intervals[settings.backupFrequency ?? 'weekly'] || intervals.weekly;
    const lastBackup = new Date(settings.lastBackupTime);
    const elapsed = Date.now() - lastBackup.getTime();

    if (elapsed >= interval) {
      return { needed: true, reason: 'overdue' };
    }

    return { needed: false, reason: 'not_due' };
  }

  // 扩展启动时检查备份
  chrome.runtime.onStartup.addListener(async () => {
    const checkResult = await checkBackupNeeded();
    if (checkResult.needed) {
      chrome.alarms.create('openpass-auto-backup', { delayInMinutes: 5 });
    }
  });

  // 扩展更新时检查备份
  chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') return;

    const checkResult = await checkBackupNeeded();
    if (checkResult.needed) {
      chrome.alarms.create('openpass-auto-backup', { delayInMinutes: 5 });
    }
  });

  function parseUrl(url: string) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const parts = hostname.split('.');
      let mainDomain = hostname;
      if (parts.length >= 2) {
        const tldPatterns = ['co.uk', 'com.au', 'co.jp', 'com.cn'];
        const lastTwo = parts.slice(-2).join('.');
        if (tldPatterns.includes(lastTwo)) {
          mainDomain = parts.slice(-3).join('.');
        } else {
          mainDomain = parts.slice(-2).join('.');
        }
      }
      return { fullUrl: url, fullDomain: hostname, mainDomain, origin: urlObj.origin };
    } catch {
      return null;
    }
  }

  function safeSetBadge(tabId: number, text: string, color: string | null = null) {
    chrome.action.setBadgeText({ tabId, text }, () => {
      if (chrome.runtime.lastError) {
        return;
      }
    });
    if (color) {
      chrome.action.setBadgeBackgroundColor({ tabId, color }, () => {
        if (chrome.runtime.lastError) {
          return;
        }
      });
    }
  }

  async function updateBadgeForTab(tabId: number, url: string) {
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
      safeSetBadge(tabId, '');
      return;
    }

    const result = await chrome.storage.local.get<{
      sitesList?: SiteListItem[];
      secrets?: StoredSecret[];
    }>(['sitesList', 'secrets']);
    let sites = Array.isArray(result.sitesList) ? result.sitesList : [];
    if (sites.length === 0 && Array.isArray(result.secrets)) {
      sites = result.secrets.map((secret) => ({ site: secret.site }));
    }

    const urlInfo = parseUrl(url);
    if (!urlInfo) {
      safeSetBadge(tabId, '');
      return;
    }

    let matchCount = 0;
    for (const item of sites) {
      const site = item.site.toLowerCase();
      const fullDomain = urlInfo.fullDomain.toLowerCase();
      const mainDomain = urlInfo.mainDomain.toLowerCase();

      if (fullDomain.includes(site) || site.includes(fullDomain) ||
          mainDomain.includes(site) || site.includes(mainDomain)) {
        matchCount++;
      }
    }

    if (matchCount > 0) {
      safeSetBadge(tabId, matchCount.toString(), '#4f46e5');
    } else {
      safeSetBadge(tabId, '');
    }
  }
});


