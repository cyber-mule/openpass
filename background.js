/**
 * 2FA Authenticator - Background Service Worker
 * 处理扩展图标 badge 显示当前网站匹配的密钥数量
 */

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