/**
 * 通用 UI 工具模块
 */

/**
 * 显示 Toast 提示
 */
export function showToast(message: string, type: 'success' | 'error' | 'warning' | 'default' = 'default') {
  const oldToast = document.querySelector('.openpass-toast');
  if (oldToast) oldToast.remove();

  const toast = document.createElement('div');
  toast.className = `openpass-toast openpass-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('openpass-toast-show');
  });

  setTimeout(() => {
    toast.classList.remove('openpass-toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

/**
 * 显示确认对话框
 */
export function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    resolve(confirm(message));
  });
}

/**
 * 解析 URL 获取域名信息
 */
export function parseUrl(url: string) {
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

    return {
      fullUrl: url,
      fullDomain: hostname,
      mainDomain,
      origin: urlObj.origin
    };
  } catch {
    return null;
  }
}

/**
 * 匹配密钥与当前页面
 */
export function matchSecrets(url: string, secrets: Array<{ site: string }>) {
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
 * 安全发送消息到扩展
 */
export async function safeSendMessage<TMessage, TResponse = unknown>(message: TMessage): Promise<TResponse | null> {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (chrome.runtime.lastError) {
      throw new Error(chrome.runtime.lastError.message);
    }
    return response as TResponse;
  } catch (error) {
    if ((error as Error).message?.includes('Extension context invalidated')) {
      showToast('扩展已更新，请刷新页面', 'warning');
      return null;
    }
    throw error;
  }
}

/**
 * 格式化日期时间
 */
export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return crypto.randomUUID();
}
