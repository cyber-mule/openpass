/**
 * 2FA Authenticator - Content Script
 * 自动检测 2FA 输入框并显示浮动填充按钮
 */

(function() {
  'use strict';

  // 配置
  const CONFIG = {
    // 2FA 输入框关键词
    keywords: [
      'otp', 'totp', '2fa', 'mfa', 'auth', 'verification', 'verify',
      'code', 'pin', 'token', 'one-time', 'onetime',
      '验证码', '动态码', '安全码', '一次性密码'
    ],
    // 排除的关键词（避免误检测密码框）
    excludeKeywords: ['password', 'passwd', 'pwd', '密码'],
    // 目标输入框长度
    targetLengths: [6, 8],
    // 检测间隔
    checkInterval: 1000,
    // 浮动按钮显示延迟
    showDelay: 300
  };

  // 状态
  let detectedInputs = new Set();
  let floatingButtons = new Map();
  let currentSecrets = [];
  let currentUrl = window.location.href;

  /**
   * 初始化
   */
  function init() {
    // 获取当前网站的密钥
    fetchSecrets();

    // 监听存储变化
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.secrets) {
        fetchSecrets();
      }
    });

    // 监听 URL 变化（SPA 支持）
    observeUrlChange();

    // 开始检测输入框
    startDetection();
  }

  /**
   * 获取密钥
   */
  function fetchSecrets() {
    chrome.storage.local.get(['secrets'], (result) => {
      currentSecrets = result.secrets || [];
      // 更新所有浮动按钮状态
      updateAllButtons();
    });
  }

  /**
   * 获取当前网站匹配的密钥
   */
  function getMatchingSecrets() {
    const domain = extractDomain(currentUrl);
    if (!domain) return [];

    return currentSecrets.filter(secret => {
      const site = secret.site.toLowerCase();
      const lowerDomain = domain.toLowerCase();
      return lowerDomain.includes(site) || site.includes(lowerDomain);
    });
  }

  /**
   * 提取域名
   */
  function extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (e) {
      return null;
    }
  }

  /**
   * 监听 URL 变化
   */
  function observeUrlChange() {
    // 监听 pushState
    const originalPushState = history.pushState;
    history.pushState = function() {
      originalPushState.apply(this, arguments);
      onUrlChange();
    };

    // 监听 replaceState
    const originalReplaceState = history.replaceState;
    history.replaceState = function() {
      originalReplaceState.apply(this, arguments);
      onUrlChange();
    };

    // 监听 popstate
    window.addEventListener('popstate', onUrlChange);
  }

  /**
   * URL 变化处理
   */
  function onUrlChange() {
    if (currentUrl !== window.location.href) {
      currentUrl = window.location.href;
      // 清除旧的浮动按钮
      removeAllButtons();
      detectedInputs.clear();
      // 重新检测
      startDetection();
    }
  }

  /**
   * 开始检测输入框
   */
  function startDetection() {
    // 立即检测一次
    detectInputs();

    // 定期检测
    setInterval(detectInputs, CONFIG.checkInterval);

    // 监听 DOM 变化
    observeDOM();
  }

  /**
   * 监听 DOM 变化
   */
  function observeDOM() {
    const observer = new MutationObserver((mutations) => {
      let shouldCheck = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldCheck = true;
          break;
        }
      }
      if (shouldCheck) {
        detectInputs();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * 检测 2FA 输入框
   */
  function detectInputs() {
    const inputs = document.querySelectorAll('input');

    inputs.forEach(input => {
      // 跳过已检测的
      if (detectedInputs.has(input)) return;

      // 跳过隐藏的
      if (input.type === 'hidden' || input.offsetParent === null) return;

      // 检测是否为 2FA 输入框
      if (is2FAInput(input)) {
        detectedInputs.add(input);
        createFloatingButton(input);
      }
    });

    // 清理已移除的输入框
    cleanupRemovedInputs();
  }

  /**
   * 判断是否为 2FA 输入框
   */
  function is2FAInput(input) {
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const autocomplete = (input.autocomplete || '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
    const maxLength = parseInt(input.maxLength) || parseInt(input.getAttribute('maxlength')) || 0;

    // 检查排除关键词
    const allText = `${name} ${id} ${placeholder} ${autocomplete} ${ariaLabel}`;
    for (const keyword of CONFIG.excludeKeywords) {
      if (allText.includes(keyword)) {
        return false;
      }
    }

    // 检查关键词匹配
    let keywordMatch = false;
    for (const keyword of CONFIG.keywords) {
      if (allText.includes(keyword)) {
        keywordMatch = true;
        break;
      }
    }

    // 检查 autocomplete 属性
    if (autocomplete.includes('one-time-code') || autocomplete.includes('otp')) {
      keywordMatch = true;
    }

    // 检查长度限制
    const lengthMatch = CONFIG.targetLengths.includes(maxLength);

    // 检查输入类型
    const validTypes = ['text', 'tel', 'number', 'password'];
    const typeValid = validTypes.includes(input.type);

    // 综合判断
    // 1. 有关键词匹配
    // 2. 或者长度为 6/8 且是有效类型
    return typeValid && (keywordMatch || lengthMatch);
  }

  /**
   * 创建浮动按钮
   */
  function createFloatingButton(input) {
    // 检查是否已有按钮
    if (floatingButtons.has(input)) return;

    const button = document.createElement('div');
    button.className = 'totppass-float-btn';
    button.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
    `;
    button.title = 'TOTPPass - 填充验证码';

    // 点击事件
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fillCode(input, button);
    });

    // 插入到输入框后面
    const wrapper = createWrapper(input);
    wrapper.appendChild(button);

    floatingButtons.set(input, { wrapper, button });
    updateButtonState(button);
  }

  /**
   * 创建包装器
   */
  function createWrapper(input) {
    const parent = input.parentNode;
    const wrapper = document.createElement('div');
    wrapper.className = 'totppass-input-wrapper';

    // 计算输入框的位置和大小
    const rect = input.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(input);

    // 设置包装器样式
    wrapper.style.cssText = `
      position: relative;
      display: inline-block;
      width: ${rect.width}px;
    `;

    // 将输入框移入包装器
    parent.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    return wrapper;
  }

  /**
   * 填充验证码
   */
  async function fillCode(input, button) {
    const matches = getMatchingSecrets();

    if (matches.length === 0) {
      showToast('未找到当前网站的密钥', 'error');
      return;
    }

    // 如果有多个匹配，显示选择列表
    if (matches.length > 1) {
      showSecretSelector(input, button, matches);
      return;
    }

    // 只有一个密钥，直接填充
    await doFillCode(input, button, matches[0]);
  }

  /**
   * 显示密钥选择列表
   */
  function showSecretSelector(input, button, matches) {
    // 移除已存在的选择器
    const existingSelector = document.querySelector('.totppass-selector');
    if (existingSelector) existingSelector.remove();

    const selector = document.createElement('div');
    selector.className = 'totppass-selector';

    let html = '<div class="totppass-selector-header">选择要填充的密钥</div>';
    html += '<div class="totppass-selector-list">';

    matches.forEach((secret, index) => {
      const name = secret.name || secret.site;
      html += `
        <div class="totppass-selector-item" data-index="${index}">
          <div class="totppass-selector-name">${name}</div>
          <div class="totppass-selector-site">${secret.site}</div>
        </div>
      `;
    });

    html += '</div>';
    selector.innerHTML = html;

    // 定位选择器
    const rect = button.getBoundingClientRect();
    selector.style.top = `${rect.bottom + 8}px`;
    selector.style.right = `${window.innerWidth - rect.right}px`;

    document.body.appendChild(selector);

    // 点击选项
    selector.querySelectorAll('.totppass-selector-item').forEach((item, index) => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        await doFillCode(input, button, matches[index]);
        selector.remove();
      });
    });

    // 点击其他地方关闭
    const closeHandler = (e) => {
      if (!selector.contains(e.target)) {
        selector.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  /**
   * 执行填充验证码
   */
  async function doFillCode(input, button, secret) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'generateCode',
        secret: secret.secret,
        digits: secret.digits
      });

      if (response && response.code) {
        // 填充验证码
        input.value = response.code;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // 视觉反馈
        button.classList.add('totppass-success');
        setTimeout(() => button.classList.remove('totppass-success'), 1000);

        showToast('验证码已填充', 'success');
      }
    } catch (error) {
      console.error('TOTPPass: 填充失败', error);
      showToast('填充失败', 'error');
    }
  }

  /**
   * 更新浮动按钮状态
   */
  function updateButtonState(button) {
    const matches = getMatchingSecrets();
    if (matches.length > 0) {
      button.classList.add('totppass-has-secret');
      button.title = `TOTPPass - 点击填充验证码 (${matches.length} 个密钥)`;
    } else {
      button.classList.remove('totppass-has-secret');
      button.title = 'TOTPPass - 未找到当前网站的密钥';
    }
  }

  /**
   * 更新所有按钮状态
   */
  function updateAllButtons() {
    floatingButtons.forEach(({ button }) => {
      updateButtonState(button);
    });
  }

  /**
   * 清理已移除的输入框
   */
  function cleanupRemovedInputs() {
    floatingButtons.forEach((data, input) => {
      if (!document.body.contains(input)) {
        removeButton(input);
      }
    });
  }

  /**
   * 移除浮动按钮
   */
  function removeButton(input) {
    const data = floatingButtons.get(input);
    if (data) {
      const { wrapper, button } = data;
      // 将输入框移回原位置
      const parent = wrapper.parentNode;
      if (parent && wrapper.contains(input)) {
        parent.insertBefore(input, wrapper);
      }
      wrapper.remove();
      floatingButtons.delete(input);
      detectedInputs.delete(input);
    }
  }

  /**
   * 移除所有浮动按钮
   */
  function removeAllButtons() {
    floatingButtons.forEach((data, input) => {
      removeButton(input);
    });
  }

  /**
   * 显示 Toast 提示
   */
  function showToast(message, type = 'default') {
    // 移除旧的 toast
    const oldToast = document.querySelector('.totppass-toast');
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.className = `totppass-toast totppass-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // 动画显示
    requestAnimationFrame(() => {
      toast.classList.add('totppass-toast-show');
    });

    // 自动移除
    setTimeout(() => {
      toast.classList.remove('totppass-toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();