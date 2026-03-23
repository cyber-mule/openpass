/**
 * 2FA Authenticator - Background Service Worker
 * 处理扩展图标 badge 显示当前网站匹配的密钥数量
 * 支持右键菜单解析 QR 码
 * 支持自动填充验证码
 */

// 导入 jsQR 库和 TOTP 库
importScripts('jsQR.min.js', 'totp.js', 'crypto.js');

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
    // 检查是否已设置主密码
    const setupComplete = await checkSetupComplete();
    if (!setupComplete) {
      showNotification('请先设置主密码', '点击扩展图标开始设置');
      return;
    }

    try {
      const secret = await parseQRFromImageUrl(info.srcUrl);
      if (secret) {
        // 存储待添加的密钥
        await storePendingSecret(secret, tab);
        // 直接打开弹窗
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

/**
 * 检查是否已完成设置
 */
async function checkSetupComplete() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['isSetupComplete'], (result) => {
      resolve(result.isSetupComplete === true);
    });
  });
}

/**
 * 从图片 URL 解析 QR 码（Service Worker 兼容）
 */
async function parseQRFromImageUrl(url) {
  try {
    let blob;

    // 处理 data URL
    if (url.startsWith('data:')) {
      const response = await fetch(url);
      blob = await response.blob();
    } else {
      // 对于普通 URL，通过 fetch 获取
      const response = await fetch(url, { mode: 'cors' });
      blob = await response.blob();
    }

    // 使用 createImageBitmap（Service Worker 兼容）
    const imageBitmap = await createImageBitmap(blob);

    // 使用 OffscreenCanvas 处理图片
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);

    if (code && code.data) {
      return parseOTPAuthUrl(code.data);
    }

    return null;
  } catch (error) {
    console.error('解析 QR 码失败:', error);
    throw error;
  }
}

/**
 * 解析 otpauth:// URL
 * 格式: otpauth://totp/Issuer:AccountName?secret=SECRET&issuer=Issuer
 */
function parseOTPAuthUrl(data) {
  // 直接是密钥（纯文本）
  if (/^[A-Z2-7]+=*$/i.test(data.trim())) {
    return {
      secret: data.trim().toUpperCase().replace(/\s/g, ''),
      site: '',
      name: ''
    };
  }

  // otpauth:// URL 格式
  if (data.startsWith('otpauth://')) {
    try {
      const url = new URL(data);
      const params = new URLSearchParams(url.search);

      const secret = params.get('secret');
      if (!secret) return null;

      const issuer = params.get('issuer') || '';
      const account = decodeURIComponent(url.pathname.split('/').pop() || '');
      const label = params.get('label') || '';

      // 解析站点名称
      let site = issuer;
      if (!site && account.includes(':')) {
        site = account.split(':')[0];
      }

      return {
        secret: secret.toUpperCase(),
        site: site.toLowerCase(),
        name: issuer || label || account.replace(/.*:/, '')
      };
    } catch (e) {
      console.error('解析 otpauth URL 失败:', e);
      return null;
    }
  }

  return null;
}

/**
 * 存储待添加的密钥
 */
async function storePendingSecret(secret, tab) {
  // 如果有当前标签页，尝试获取完整 URL
  if (tab && tab.url) {
    const urlInfo = parseUrl(tab.url);
    if (urlInfo && !secret.site) {
      // 保存完整 origin（协议+域名+端口）
      secret.site = urlInfo.origin;
    }
  }

  // 存储到临时位置
  await chrome.storage.local.set({ pendingSecret: secret });
}

/**
 * 显示通知
 */
function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message
  });
}

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'generateCode') {
    (async () => {
      try {
        const result = await TOTP.generate(request.secret, request.digits || 6);
        sendResponse({ code: result.code, remainingSeconds: result.remainingSeconds });
      } catch (error) {
        console.error('生成验证码失败:', error);
        sendResponse({ error: error.message });
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
        // 检查是否已设置主密码
        const setupComplete = await checkSetupComplete();
        if (!setupComplete) {
          sendResponse({ error: 'not_setup' });
          return;
        }

        // 获取加密的密钥
        const result = await chrome.storage.local.get(['encryptedSecrets', 'secrets']);
        if (result.encryptedSecrets && request.sessionKey) {
          const decrypted = await CryptoUtils.decrypt(result.encryptedSecrets, request.sessionKey);
          const secrets = JSON.parse(decrypted);
          sendResponse({ secrets });
        } else if (result.secrets) {
          sendResponse({ secrets: result.secrets });
        } else {
          sendResponse({ secrets: [] });
        }
      } catch (error) {
        console.error('获取密钥失败:', error);
        sendResponse({ error: error.message });
      }
    })();
    return true;
  }
});

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    updateBadgeForTab(tabId, tab.url);
  }
});

// 监听标签页切换
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab && tab.url) {
      updateBadgeForTab(activeInfo.tabId, tab.url);
    }
  });
});

// 监听存储变化
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && (changes.secrets || changes.encryptedSecrets || changes.sitesList)) {
    // 当密钥变化时，更新当前标签页的 badge
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        updateBadgeForTab(tabs[0].id, tabs[0].url);
      }
    });
  }
});

/**
 * 解析 URL 获取域名信息
 */
function parseUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // 提取主域名（去除子域名）
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

    return {
      fullUrl: url,
      fullDomain: hostname,
      mainDomain: mainDomain,
      origin: urlObj.origin
    };
  } catch (e) {
    return null;
  }
}

/**
 * 匹配密钥
 */
function matchSecrets(url, secrets) {
  const urlInfo = parseUrl(url);
  if (!urlInfo) return [];

  const matches = [];

  for (const secret of secrets) {
    const site = secret.site.toLowerCase();
    const fullUrl = urlInfo.fullUrl.toLowerCase();
    const fullDomain = urlInfo.fullDomain.toLowerCase();
    const mainDomain = urlInfo.mainDomain.toLowerCase();

    let matchType = null;

    if (fullUrl.includes(site) || site.includes(fullUrl)) {
      matchType = 'fullUrl';
    } else if (fullDomain === site || site === fullDomain) {
      matchType = 'fullDomain';
    } else if (mainDomain === site || site === mainDomain) {
      matchType = 'mainDomain';
    } else if (fullDomain.includes(site) || site.includes(fullDomain)) {
      matchType = 'contains';
    }

    if (matchType) {
      matches.push(secret);
    }
  }

  return matches;
}

/**
 * 更新指定标签页的 badge
 */
async function updateBadgeForTab(tabId, url) {
  // 跳过特殊页面
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
    chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }

  // 获取存储的站点列表（明文，用于 badge 显示）
  chrome.storage.local.get(['sitesList', 'secrets'], (result) => {
    // 优先使用明文站点列表
    let sites = result.sitesList || [];

    // 兼容旧版本
    if (sites.length === 0 && result.secrets) {
      sites = result.secrets.map(s => ({ site: s.site }));
    }

    const urlInfo = parseUrl(url);
    if (!urlInfo) {
      chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }

    // 匹配站点
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
      chrome.action.setBadgeText({ tabId, text: matchCount.toString() });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#4f46e5' });
    } else {
      chrome.action.setBadgeText({ tabId, text: '' });
    }
  });
}