/**
 * 2FA Authenticator - Background Service Worker
 * 处理扩展图标 badge 显示当前网站匹配的密钥数量
 * 支持右键菜单解析 QR 码
 * 支持自动填充验证码
 */

// 导入 jsQR 库和 TOTP 库
importScripts('jsQR.min.js', 'totp.js');

// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'parseQRCode',
    title: '解析 QR 码添加密钥',
    contexts: ['image']
  });
});

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'parseQRCode' && info.srcUrl) {
    try {
      const secret = await parseQRFromImageUrl(info.srcUrl);
      if (secret) {
        // 发送消息给 popup 或存储临时数据
        await storePendingSecret(secret, tab);
        // 显示通知
        showNotification('QR 码解析成功', '点击扩展图标完成添加');
      } else {
        showNotification('解析失败', '未能识别有效的 TOTP 密钥');
      }
    } catch (error) {
      console.error('解析 QR 码失败:', error);
      showNotification('解析失败', '无法读取图片中的 QR 码');
    }
  }
});

/**
 * 从图片 URL 解析 QR 码
 */
async function parseQRFromImageUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = new OffscreenCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code && code.data) {
          const secret = parseOTPAuthUrl(code.data);
          resolve(secret);
        } else {
          resolve(null);
        }
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => reject(new Error('图片加载失败'));

    // 处理 data URL 和普通 URL
    if (url.startsWith('data:')) {
      img.src = url;
    } else {
      // 对于跨域图片，尝试通过 fetch 获取
      fetch(url)
        .then(response => response.blob())
        .then(blob => {
          const reader = new FileReader();
          reader.onloadend = () => {
            img.src = reader.result;
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        })
        .catch(() => {
          // 如果 fetch 失败，直接尝试加载
          img.src = url;
        });
    }
  });
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
  // 如果有当前标签页，尝试获取域名
  if (tab && tab.url) {
    const urlInfo = parseUrl(tab.url);
    if (urlInfo && !secret.site) {
      secret.site = urlInfo.fullDomain;
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
    return true; // 保持消息通道开启
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
  if (namespace === 'local' && changes.secrets) {
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

  // 获取存储的密钥
  chrome.storage.local.get(['secrets'], (result) => {
    const secrets = result.secrets || [];
    const matches = matchSecrets(url, secrets);

    if (matches.length > 0) {
      // 显示匹配数量
      chrome.action.setBadgeText({ tabId, text: matches.length.toString() });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#4f46e5' });
    } else {
      // 清除 badge
      chrome.action.setBadgeText({ tabId, text: '' });
    }
  });
}