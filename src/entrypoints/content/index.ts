export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    const CONFIG = {
      keywords: [
        'otp', 'totp', '2fa', 'mfa', 'auth', 'verification', 'verify',
        'code', 'pin', 'token', 'one-time', 'onetime',
        '验证码', '动态码', '安全码', '一次性密码'
      ],
      excludeKeywords: ['password', 'passwd', 'pwd', '密码'],
      targetLengths: [6, 8],
      checkInterval: 1000,
      showDelay: 300
    };

    let detectedInputs = new Set<HTMLInputElement>();
    let floatingButtons = new Map<HTMLInputElement, { wrapper: HTMLDivElement; button: HTMLDivElement }>();
    let currentSecrets: any[] = [];
    let currentUrl = window.location.href;

    function init() {
      fetchSecrets();

      chrome.storage.onChanged.addListener((changes) => {
        if (changes.secrets) {
          fetchSecrets();
        }
      });

      observeUrlChange();
      startDetection();
    }

    function fetchSecrets() {
      try {
        chrome.storage.local.get(['secrets'], (result) => {
          if (chrome.runtime.lastError) {
            console.warn('OpenPass: 获取密钥失败', chrome.runtime.lastError);
            return;
          }
          currentSecrets = result.secrets || [];
          updateAllButtons();
        });
      } catch (error) {
        if ((error as Error).message?.includes('Extension context invalidated')) {
          console.warn('OpenPass: 扩展上下文已失效，请刷新页面');
          return;
        }
        throw error;
      }
    }

    function getMatchingSecrets() {
      const domain = extractDomain(currentUrl);
      if (!domain) return [];

      return currentSecrets.filter(secret => {
        const site = secret.site.toLowerCase();
        const lowerDomain = domain.toLowerCase();
        return lowerDomain.includes(site) || site.includes(lowerDomain);
      });
    }

    function extractDomain(url: string) {
      try {
        const urlObj = new URL(url);
        return urlObj.hostname;
      } catch {
        return null;
      }
    }

    function observeUrlChange() {
      const originalPushState = history.pushState;
      history.pushState = function() {
        originalPushState.apply(this, arguments);
        onUrlChange();
      };

      const originalReplaceState = history.replaceState;
      history.replaceState = function() {
        originalReplaceState.apply(this, arguments);
        onUrlChange();
      };

      window.addEventListener('popstate', onUrlChange);
    }

    function onUrlChange() {
      if (currentUrl !== window.location.href) {
        currentUrl = window.location.href;
        removeAllButtons();
        detectedInputs.clear();
        startDetection();
      }
    }

    function startDetection() {
      detectInputs();
      setInterval(detectInputs, CONFIG.checkInterval);
      observeDOM();
    }

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

    function detectInputs() {
      const inputs = document.querySelectorAll<HTMLInputElement>('input');

      inputs.forEach(input => {
        if (detectedInputs.has(input)) return;
        if (input.type === 'hidden' || input.offsetParent === null) return;

        if (is2FAInput(input)) {
          detectedInputs.add(input);
          createFloatingButton(input);
        }
      });

      cleanupRemovedInputs();
    }

    function is2FAInput(input: HTMLInputElement) {
      const name = (input.name || '').toLowerCase();
      const id = (input.id || '').toLowerCase();
      const placeholder = (input.placeholder || '').toLowerCase();
      const autocomplete = (input.autocomplete || '').toLowerCase();
      const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
      const maxLength = parseInt(input.maxLength) || parseInt(input.getAttribute('maxlength')) || 0;

      const allText = `${name} ${id} ${placeholder} ${autocomplete} ${ariaLabel}`;
      for (const keyword of CONFIG.excludeKeywords) {
        if (allText.includes(keyword)) {
          return false;
        }
      }

      let keywordMatch = false;
      for (const keyword of CONFIG.keywords) {
        if (allText.includes(keyword)) {
          keywordMatch = true;
          break;
        }
      }

      if (autocomplete.includes('one-time-code') || autocomplete.includes('otp')) {
        keywordMatch = true;
      }

      const lengthMatch = CONFIG.targetLengths.includes(maxLength);
      const validTypes = ['text', 'tel', 'number', 'password'];
      const typeValid = validTypes.includes(input.type);

      return typeValid && (keywordMatch || lengthMatch);
    }

    function createFloatingButton(input: HTMLInputElement) {
      if (floatingButtons.has(input)) return;

      const matches = getMatchingSecrets();
      if (matches.length === 0) return;

      const button = document.createElement('div');
      button.className = 'openpass-float-btn openpass-has-secret';
      button.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      `;
      button.title = `OpenPass - 点击填充验证码 (${matches.length} 个密钥)`;

      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fillCode(input, button);
      });

      const wrapper = createWrapper(input);
      wrapper.appendChild(button);

      floatingButtons.set(input, { wrapper, button });
    }

    function createWrapper(input: HTMLInputElement) {
      const parent = input.parentNode!;
      const wrapper = document.createElement('div');
      wrapper.className = 'openpass-input-wrapper';

      const rect = input.getBoundingClientRect();
      wrapper.style.cssText = `
        position: relative;
        display: inline-block;
        width: ${rect.width}px;
      `;

      parent.insertBefore(wrapper, input);
      wrapper.appendChild(input);

      return wrapper;
    }

    async function fillCode(input: HTMLInputElement, button: HTMLDivElement) {
      const matches = getMatchingSecrets();

      if (matches.length === 0) {
        showToast('未找到当前网站的密钥', 'error');
        return;
      }

      if (matches.length > 1) {
        showSecretSelector(input, button, matches);
        return;
      }

      await doFillCode(input, button, matches[0]);
    }

    async function safeSendMessage(message: any) {
      try {
        const response = await chrome.runtime.sendMessage(message);
        if (chrome.runtime.lastError) {
          throw new Error(chrome.runtime.lastError.message);
        }
        return response;
      } catch (error) {
        if ((error as Error).message?.includes('Extension context invalidated')) {
          showToast('扩展已更新，请刷新页面', 'warning');
          return null;
        }
        throw error;
      }
    }

    function showSecretSelector(input: HTMLInputElement, button: HTMLDivElement, matches: any[]) {
      const existingSelector = document.querySelector('.openpass-selector');
      if (existingSelector) existingSelector.remove();

      const selector = document.createElement('div');
      selector.className = 'openpass-selector';

      let html = '<div class="openpass-selector-header">选择要填充的密钥</div>';
      html += '<div class="openpass-selector-list">';

      matches.forEach((secret, index) => {
        const name = secret.name || secret.site;
        html += `
          <div class="openpass-selector-item" data-index="${index}">
            <div class="openpass-selector-info">
              <div class="openpass-selector-name">${name}</div>
              <div class="openpass-selector-site">${secret.site}</div>
            </div>
          </div>
        `;
      });

      html += '</div>';
      selector.innerHTML = html;

      const rect = button.getBoundingClientRect();
      selector.style.top = `${rect.bottom + 8}px`;
      selector.style.right = `${window.innerWidth - rect.right}px`;

      document.body.appendChild(selector);

      selector.querySelectorAll('.openpass-selector-item').forEach((item, index) => {
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          await doFillCode(input, button, matches[index]);
          selector.remove();
        });
      });

      const closeHandler = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest('.openpass-selector')) {
          selector.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }

    async function doFillCode(input: HTMLInputElement, button: HTMLDivElement, secret: any) {
      try {
        const response = await safeSendMessage({
          action: 'generateCode',
          secret: secret.secret,
          digits: secret.digits
        });

        if (response && response.code) {
          input.value = response.code;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));

          button.classList.add('openpass-success');
          setTimeout(() => button.classList.remove('openpass-success'), 1000);

          showToast('验证码已填充', 'success');
        }
      } catch (error) {
        console.error('OpenPass: 填充失败', error);
        showToast('填充失败', 'error');
      }
    }

    function updateAllButtons() {
      floatingButtons.forEach(({ button }, input) => {
        const matches = getMatchingSecrets();
        if (matches.length === 0) {
          removeButton(input);
        }
      });

      detectInputs();
    }

    function cleanupRemovedInputs() {
      floatingButtons.forEach((data, input) => {
        if (!document.body.contains(input)) {
          removeButton(input);
        }
      });
    }

    function removeButton(input: HTMLInputElement) {
      const data = floatingButtons.get(input);
      if (data) {
        const { wrapper, button } = data;
        const parent = wrapper.parentNode;
        if (parent && wrapper.contains(input)) {
          parent.insertBefore(input, wrapper);
        }
        wrapper.remove();
        floatingButtons.delete(input);
        detectedInputs.delete(input);
      }
    }

    function removeAllButtons() {
      floatingButtons.forEach((data, input) => {
        removeButton(input);
      });
    }

    function showToast(message: string, type: string = 'default') {
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

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
});
