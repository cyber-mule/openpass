export default defineBackground(() => {
  importScripts('jsQR.min.js', 'totp.js');

  // 创建右键菜单
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'parseQRCode',
      title: '识别并添加',
      contexts: ['image']
    });
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
    const response = await fetch(url);
    const blob = await response.blob();
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
