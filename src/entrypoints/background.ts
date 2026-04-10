export default defineBackground(() => {
  importScripts('/jsQR.min.js', '/totp.js');

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

    // 首次安装时自动打开管理页面（新窗口）
    if (details.reason === 'install') {
      const url = chrome.runtime.getURL('options.html');
      chrome.windows.create({
        url,
        type: 'normal',
        width: 1200,
        height: 800,
        focused: true
      });
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
        console.error('解析 QR 码失败:', error);
        showNotification('识别失败', '无法读取图片中的 QR 码');
      }
    }
  });

  async function checkSetupComplete(): Promise<boolean> {
    const result = await chrome.storage.local.get(['isSetupComplete']);
    return result.isSetupComplete === true;
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
      ctx.drawImage(imageBitmap, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = (globalThis as any).jsQR(imageData.data, imageData.width, imageData.height);

      if (code && code.data) {
        return parseOTPAuthUrl(code.data);
      }
      return null;
    } catch (error) {
      console.error('解析 QR 码失败:', error);
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

  async function storePendingSecret(secret: any, tab: chrome.tabs.Tab) {
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
          const result = await (globalThis as any).TOTP.generate(request.secret, request.digits || 6);
          sendResponse({ code: result.code, remainingSeconds: result.remainingSeconds });
        } catch (error) {
          sendResponse({ error: (error as Error).message });
        }
      })();
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

          const result = await chrome.storage.local.get(['encryptedSecrets', 'secrets']);
          if (result.encryptedSecrets && request.sessionKey) {
            const CryptoUtils = await import('../utils/crypto');
            const decrypted = await CryptoUtils.default.decrypt(result.encryptedSecrets, request.sessionKey);
            const secrets = JSON.parse(decrypted);
            sendResponse({ secrets });
          } else if (result.secrets) {
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
        if (tabs[0] && tabs[0].url) {
          updateBadgeForTab(tabs[0].id, tabs[0].url);
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

      const settings = await chrome.storage.local.get([
        'enableAutoBackup',
        'enableLocalSnapshot',
        'enableDirectoryBackup',
        'encryptedSecrets',
        'secrets'
      ]);

      if (!settings.enableAutoBackup) return;

      let secrets = [];
      if (settings.encryptedSecrets) {
        console.log('OpenPass: 密钥已加密，需要用户交互才能备份');
        showNotification('自动备份提醒', '请打开 OpenPass 完成备份');
        return;
      } else if (settings.secrets) {
        secrets = settings.secrets;
      }

      if (secrets.length === 0) return;

      const backupData = {
        format: 'openpass-backup',
        formatVersion: 1,
        appVersion: chrome.runtime.getManifest().version,
        exportTime: new Date().toISOString(),
        count: secrets.length,
        encrypted: false,
        secrets
      };

      if (settings.enableLocalSnapshot) {
        const result = await chrome.storage.local.get(['backupSnapshots']);
        let snapshots = result.backupSnapshots || [];

        snapshots.unshift({
          data: backupData,
          timestamp: new Date().toISOString(),
          count: backupData.count
        });

        if (snapshots.length > 5) {
          snapshots = snapshots.slice(0, 5);
        }

        await chrome.storage.local.set({ backupSnapshots: snapshots });
      }

      await chrome.storage.local.set({
        lastBackupTime: new Date().toISOString()
      });

      console.log('OpenPass: 自动备份完成');

      if (settings.enableLocalSnapshot) {
        showNotification('自动备份完成', `已备份 ${secrets.length} 个密钥到本地快照`);
      }
    } catch (error) {
      console.error('OpenPass: 自动备份失败', error);
      showNotification('自动备份失败', (error as Error).message);
    }
  }

  async function checkBackupNeeded() {
    const settings = await chrome.storage.local.get([
      'enableAutoBackup',
      'backupFrequency',
      'lastBackupTime'
    ]);

    if (!settings.enableAutoBackup) {
      return { needed: false, reason: 'disabled' };
    }

    if (!settings.lastBackupTime) {
      return { needed: true, reason: 'never' };
    }

    const intervals: Record<string, number> = {
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000
    };

    const interval = intervals[settings.backupFrequency] || intervals.weekly;
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
      if (chrome.runtime.lastError) {}
    });
    if (color) {
      chrome.action.setBadgeBackgroundColor({ tabId, color }, () => {
        if (chrome.runtime.lastError) {}
      });
    }
  }

  async function updateBadgeForTab(tabId: number, url: string) {
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
      safeSetBadge(tabId, '');
      return;
    }

    const result = await chrome.storage.local.get(['sitesList', 'secrets']);
    let sites = result.sitesList || [];
    if (sites.length === 0 && result.secrets) {
      sites = result.secrets.map((s: any) => ({ site: s.site }));
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
