/**
 * OpenPass - Background Service Worker
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
  // 获取当前页面的完整 URL
  let pageUrl = '';
  if (tab && tab.url) {
    const urlInfo = parseUrl(tab.url);
    if (urlInfo) {
      pageUrl = urlInfo.fullUrl;
    }
  }

  // 优先级：二维码中的 issuer > 当前页面 URL
  // 如果二维码中指定了 issuer，使用二维码的；否则使用当前页面 URL
  if (!secret.site && pageUrl) {
    secret.site = pageUrl;
  }
  // 如果二维码有 site（issuer），保持不变

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

/**
 * 自动备份定时器处理
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'openpass-auto-backup') {
    console.log('OpenPass: 检查是否需要自动备份...');

    try {
      // 检查是否需要备份
      const checkResult = await checkBackupNeeded();

      if (!checkResult.needed) {
        console.log('OpenPass: 尚未到备份时间');
        return;
      }

      // 检查是否启用自动备份
      const settings = await chrome.storage.local.get([
        'enableAutoBackup',
        'enableLocalSnapshot',
        'enableDirectoryBackup',
        'encryptedSecrets',
        'secrets'
      ]);

      if (!settings.enableAutoBackup) {
        console.log('OpenPass: 自动备份未启用');
        return;
      }

      // 获取密钥（需要解密）
      let secrets = [];
      if (settings.encryptedSecrets) {
        // 需要会话密钥，但在 Service Worker 中无法获取
        // 所以自动备份只能备份明文存储的密钥或需要用户交互
        console.log('OpenPass: 密钥已加密，需要用户交互才能备份');
        showNotification('自动备份提醒', '请打开 OpenPass 完成备份');
        return;
      } else if (settings.secrets) {
        secrets = settings.secrets;
      }

      if (secrets.length === 0) {
        console.log('OpenPass: 没有密钥需要备份');
        return;
      }

      // 创建备份数据
      const backupData = {
        format: 'openpass-backup',
        formatVersion: 1,
        appVersion: chrome.runtime.getManifest().version,
        exportTime: new Date().toISOString(),
        count: secrets.length,
        encrypted: false,
        secrets: secrets
      };

      // 保存本地快照
      if (settings.enableLocalSnapshot) {
        const result = await chrome.storage.local.get(['backupSnapshots']);
        let snapshots = result.backupSnapshots || [];

        snapshots.unshift({
          data: backupData,
          timestamp: new Date().toISOString(),
          count: backupData.count
        });

        // 保留最近 5 个
        if (snapshots.length > 5) {
          snapshots = snapshots.slice(0, 5);
        }

        await chrome.storage.local.set({ backupSnapshots: snapshots });
      }

      // 更新备份时间
      await chrome.storage.local.set({
        lastBackupTime: new Date().toISOString()
      });

      console.log('OpenPass: 自动备份完成');

      // 显示通知
      if (settings.enableLocalSnapshot) {
        showNotification('自动备份完成', `已备份 ${secrets.length} 个密钥到本地快照`);
      }
    } catch (error) {
      console.error('OpenPass: 自动备份失败', error);
      showNotification('自动备份失败', error.message);
    }
  }
});

/**
 * 检查是否需要备份
 */
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

  // 计算间隔
  const intervals = {
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

/**
 * 扩展启动时检查备份
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('OpenPass: 浏览器启动，检查备份状态...');

  const checkResult = await checkBackupNeeded();

  if (checkResult.needed) {
    console.log('OpenPass: 需要备份，触发定时器');
    // 触发备份检查（延迟 5 分钟，等待浏览器稳定）
    chrome.alarms.create('openpass-auto-backup', {
      delayInMinutes: 5
    });
  }
});

/**
 * 扩展安装/更新时检查备份
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // 新安装，不需要备份
    return;
  }

  console.log('OpenPass: 扩展更新，检查备份状态...');

  const checkResult = await checkBackupNeeded();

  if (checkResult.needed) {
    // 设置定时器
    chrome.alarms.create('openpass-auto-backup', {
      delayInMinutes: 5
    });
  }
});