import { installGlobalRuntimeErrorListeners } from '@/utils/runtimeErrors';

interface ContentSecret {
  secret: string;
  site: string;
  name?: string;
  digits?: number;
}

interface FloatingButtonEntry {
  wrapper: HTMLDivElement;
  button: HTMLDivElement;
}

interface GenerateCodeResponse {
  code: string;
  remainingSeconds: number;
}

interface UrlInfo {
  fullUrl: string;
  fullDomain: string;
  mainDomain: string;
  origin: string;
}

const CONFIG = {
  keywords: [
    'otp',
    'totp',
    '2fa',
    'mfa',
    'auth',
    'verification',
    'verify',
    'code',
    'pin',
    'token',
    'one-time',
    'onetime',
    '验证码',
    '动态码',
    '安全码',
    '一次性密码'
  ],
  excludeKeywords: ['password', 'passwd', 'pwd', '密码'],
  targetLengths: [6, 8],
  checkInterval: 1000
} as const;

installGlobalRuntimeErrorListeners('content');

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    const detectedInputs = new Set<HTMLInputElement>();
    const floatingButtons = new Map<HTMLInputElement, FloatingButtonEntry>();
    let currentSecrets: ContentSecret[] = [];
    let currentUrl = window.location.href;
    let detectionIntervalId: number | null = null;
    let domObserver: MutationObserver | null = null;

    function parseUrl(value: string): UrlInfo | null {
      try {
        const url = value.includes('://') ? new URL(value) : new URL(`https://${value}`);
        const hostname = url.hostname;
        const parts = hostname.split('.');
        let mainDomain = hostname;

        if (parts.length >= 2) {
          const tldPatterns = ['co.uk', 'com.au', 'co.jp', 'com.cn'];
          const lastTwo = parts.slice(-2).join('.');
          mainDomain = tldPatterns.includes(lastTwo)
            ? parts.slice(-3).join('.')
            : parts.slice(-2).join('.');
        }

        return {
          fullUrl: url.href,
          fullDomain: hostname,
          mainDomain,
          origin: url.origin
        };
      } catch {
        return null;
      }
    }

    function normalizeSite(site: string) {
      return site.trim().toLowerCase();
    }

    function closeSelector() {
      const selector = document.querySelector<HTMLDivElement>('.openpass-selector');
      if (!selector) {
        return;
      }

      clearSelectorInterval(selector);
      selector.remove();
    }

    function removeAllButtons() {
      closeSelector();
      floatingButtons.forEach((_, input) => {
        removeButton(input);
      });
    }

    function matchesCurrentSite(secret: ContentSecret) {
      const currentInfo = parseUrl(currentUrl);
      const rawSite = normalizeSite(secret.site || '');
      if (!currentInfo || !rawSite) {
        return false;
      }

      const siteInfo = parseUrl(rawSite);
      const candidates = [
        currentInfo.fullUrl.toLowerCase(),
        currentInfo.origin.toLowerCase(),
        currentInfo.fullDomain.toLowerCase(),
        currentInfo.mainDomain.toLowerCase()
      ];

      if (candidates.some((candidate) => candidate.includes(rawSite) || rawSite.includes(candidate))) {
        return true;
      }

      if (!siteInfo) {
        return false;
      }

      const siteCandidates = [siteInfo.fullDomain.toLowerCase(), siteInfo.mainDomain.toLowerCase()];
      return candidates.some((candidate) =>
        siteCandidates.some(
          (siteCandidate) => candidate.includes(siteCandidate) || siteCandidate.includes(candidate)
        )
      );
    }

    function getMatchingSecrets(): ContentSecret[] {
      return currentSecrets.filter((secret) => matchesCurrentSite(secret));
    }

    async function fetchSecrets() {
      try {
        const result = await chrome.storage.local.get<{ secrets?: ContentSecret[] }>(['secrets']);
        currentSecrets = Array.isArray(result.secrets) ? result.secrets : [];
        updateAllButtons();
      } catch (error) {
        if ((error as Error).message?.includes('Extension context invalidated')) {
          console.warn('OpenPass: 扩展上下文已失效，请刷新页面');
          return;
        }

        throw error;
      }
    }

    function observeUrlChange() {
      const originalPushState = history.pushState;
      history.pushState = function (...args: Parameters<History['pushState']>) {
        originalPushState.apply(this, args);
        onUrlChange();
      };

      const originalReplaceState = history.replaceState;
      history.replaceState = function (...args: Parameters<History['replaceState']>) {
        originalReplaceState.apply(this, args);
        onUrlChange();
      };

      window.addEventListener('popstate', onUrlChange);
    }

    function onUrlChange() {
      if (currentUrl === window.location.href) {
        return;
      }

      currentUrl = window.location.href;
      removeAllButtons();
      detectedInputs.clear();
      detectInputs();
    }

    function startDetection() {
      detectInputs();

      if (detectionIntervalId === null) {
        detectionIntervalId = window.setInterval(detectInputs, CONFIG.checkInterval);
      }

      if (!domObserver && document.body) {
        domObserver = new MutationObserver((mutations) => {
          const shouldCheck = mutations.some((mutation) => mutation.addedNodes.length > 0);
          if (shouldCheck) {
            detectInputs();
          }
        });

        domObserver.observe(document.body, {
          childList: true,
          subtree: true
        });
      }
    }

    function is2FAInput(input: HTMLInputElement): boolean {
      const name = (input.name || '').toLowerCase();
      const id = (input.id || '').toLowerCase();
      const placeholder = (input.placeholder || '').toLowerCase();
      const autocomplete = (input.autocomplete || '').toLowerCase();
      const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
      const maxLengthAttr = input.getAttribute('maxlength');
      const maxLength =
        input.maxLength > 0
          ? input.maxLength
          : maxLengthAttr
            ? Number.parseInt(maxLengthAttr, 10)
            : 0;

      const allText = `${name} ${id} ${placeholder} ${autocomplete} ${ariaLabel}`;
      if (CONFIG.excludeKeywords.some((keyword) => allText.includes(keyword))) {
        return false;
      }

      const keywordMatch =
        CONFIG.keywords.some((keyword) => allText.includes(keyword)) ||
        autocomplete.includes('one-time-code') ||
        autocomplete.includes('otp');
      const lengthMatch = (CONFIG.targetLengths as readonly number[]).includes(maxLength);
      const typeValid = ['text', 'tel', 'number', 'password'].includes(input.type);

      return typeValid && (keywordMatch || lengthMatch);
    }

    function createWrapper(input: HTMLInputElement) {
      const parent = input.parentNode;
      if (!(parent instanceof HTMLElement)) {
        throw new Error('Unable to wrap input without a parent element');
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'openpass-input-wrapper';
      wrapper.style.cssText = `
        position: relative;
        display: inline-block;
        width: ${Math.max(input.getBoundingClientRect().width, input.offsetWidth)}px;
      `;

      parent.insertBefore(wrapper, input);
      wrapper.appendChild(input);
      return wrapper;
    }

    function createFloatingButton(input: HTMLInputElement) {
      if (floatingButtons.has(input)) {
        return;
      }

      const matches = getMatchingSecrets();
      if (matches.length === 0) {
        return;
      }

      const button = document.createElement('div');
      button.className = 'openpass-float-btn openpass-has-secret';
      button.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      `;
      button.title = `OpenPass - 点击填充验证码 (${matches.length} 个密钥)`;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void fillCode(input, button);
      });

      const wrapper = createWrapper(input);
      wrapper.appendChild(button);
      floatingButtons.set(input, { wrapper, button });
    }

    function cleanupRemovedInputs() {
      floatingButtons.forEach((_, input) => {
        if (!document.body.contains(input)) {
          removeButton(input);
        }
      });
    }

    function detectInputs() {
      const inputs = document.querySelectorAll<HTMLInputElement>('input');

      inputs.forEach((input) => {
        if (detectedInputs.has(input)) {
          return;
        }

        if (input.type === 'hidden' || input.offsetParent === null) {
          return;
        }

        if (!is2FAInput(input)) {
          return;
        }

        detectedInputs.add(input);
        createFloatingButton(input);
      });

      cleanupRemovedInputs();
    }

    async function safeSendMessage(
      message: Record<string, unknown>
    ): Promise<GenerateCodeResponse | null> {
      try {
        const response = await chrome.runtime.sendMessage(message);
        if (chrome.runtime.lastError) {
          throw new Error(chrome.runtime.lastError.message);
        }

        return response as GenerateCodeResponse;
      } catch (error) {
        if ((error as Error).message?.includes('Extension context invalidated')) {
          showToast('扩展已更新，请刷新页面', 'warning');
          return null;
        }

        throw error;
      }
    }

    function formatCode(code: string) {
      if (code.length === 6) {
        return `${code.slice(0, 3)} ${code.slice(3)}`;
      }

      if (code.length === 8) {
        return `${code.slice(0, 4)} ${code.slice(4)}`;
      }

      return code;
    }

    function clearSelectorInterval(selector: HTMLDivElement) {
      if (!selector.dataset.intervalId) {
        return;
      }

      window.clearInterval(Number.parseInt(selector.dataset.intervalId, 10));
      delete selector.dataset.intervalId;
    }

    function startCountdown(selector: HTMLDivElement, matches: ContentSecret[]) {
      const countdownElements = selector.querySelectorAll<HTMLElement>('.openpass-countdown');
      if (countdownElements.length === 0) {
        return;
      }

      const intervalId = window.setInterval(async () => {
        if (!document.body.contains(selector)) {
          window.clearInterval(intervalId);
          return;
        }

        let needRefresh = false;

        countdownElements.forEach((element) => {
          let remaining = Number.parseInt(element.dataset.remaining || '0', 10) - 1;
          if (remaining <= 0) {
            remaining = 0;
            needRefresh = true;
          }

          element.dataset.remaining = remaining.toString();
          element.textContent = `${remaining}s`;
          element.classList.toggle('openpass-countdown-warning', remaining <= 10 && remaining > 5);
          element.classList.toggle('openpass-countdown-urgent', remaining <= 5);
        });

        if (!needRefresh) {
          return;
        }

        window.clearInterval(intervalId);

        const codeValues = selector.querySelectorAll<HTMLElement>('.openpass-code-value');
        for (let index = 0; index < matches.length; index += 1) {
          try {
            const response = await safeSendMessage({
              action: 'generateCode',
              secret: matches[index].secret,
              digits: matches[index].digits
            });

            if (!response) {
              continue;
            }

            codeValues[index].textContent = formatCode(response.code);
            countdownElements[index].dataset.remaining = response.remainingSeconds.toString();
            countdownElements[index].textContent = `${response.remainingSeconds}s`;
            countdownElements[index].classList.remove(
              'openpass-countdown-warning',
              'openpass-countdown-urgent'
            );
          } catch (error) {
            console.error('OpenPass: 刷新验证码失败', error);
          }
        }

        startCountdown(selector, matches);
      }, 1000);

      selector.dataset.intervalId = intervalId.toString();
    }

    async function doFillCode(
      input: HTMLInputElement,
      button: HTMLDivElement,
      secret: ContentSecret
    ) {
      try {
        const response = await safeSendMessage({
          action: 'generateCode',
          secret: secret.secret,
          digits: secret.digits
        });

        if (!response?.code) {
          return;
        }

        input.value = response.code;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        button.classList.add('openpass-success');
        window.setTimeout(() => button.classList.remove('openpass-success'), 1000);
        showToast('验证码已填充', 'success');
      } catch (error) {
        console.error('OpenPass: 填充失败', error);
        showToast('填充失败', 'error');
      }
    }

    async function showSecretSelector(
      input: HTMLInputElement,
      button: HTMLDivElement,
      matches: ContentSecret[]
    ) {
      closeSelector();

      const selector = document.createElement('div');
      selector.className = 'openpass-selector';

      let html = '<div class="openpass-selector-header">选择要填充的密钥</div>';
      html += '<div class="openpass-selector-list">';

      const codesData: Array<GenerateCodeResponse | null> = [];
      for (const secret of matches) {
        try {
          const response = await safeSendMessage({
            action: 'generateCode',
            secret: secret.secret,
            digits: secret.digits
          });
          codesData.push(response);
        } catch {
          codesData.push(null);
        }
      }

      matches.forEach((secret, index) => {
        const codeData = codesData[index];
        const code = codeData?.code || '------';
        const remaining = codeData?.remainingSeconds || 30;
        const name = secret.name || secret.site;

        html += `
          <div class="openpass-selector-item" data-index="${index}">
            <div class="openpass-selector-info">
              <div class="openpass-selector-name">${name}</div>
              <div class="openpass-selector-site">${secret.site}</div>
            </div>
            <div class="openpass-selector-code">
              <span class="openpass-code-value">${formatCode(code)}</span>
              <span class="openpass-countdown" data-remaining="${remaining}">${remaining}s</span>
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

      startCountdown(selector, matches);

      selector.querySelectorAll<HTMLElement>('.openpass-selector-item').forEach((item, index) => {
        item.addEventListener('click', async (event) => {
          event.stopPropagation();
          clearSelectorInterval(selector);
          await doFillCode(input, button, matches[index]);
          selector.remove();
        });
      });

      const closeHandler = (event: MouseEvent) => {
        const target = event.target;
        if (target instanceof Node && !selector.contains(target)) {
          clearSelectorInterval(selector);
          selector.remove();
          document.removeEventListener('click', closeHandler);
        }
      };

      window.setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }

    async function fillCode(input: HTMLInputElement, button: HTMLDivElement) {
      const matches = getMatchingSecrets();

      if (matches.length === 0) {
        showToast('未找到当前网站的密钥', 'error');
        return;
      }

      if (matches.length > 1) {
        await showSecretSelector(input, button, matches);
        return;
      }

      await doFillCode(input, button, matches[0]);
    }

    function updateButtonState(input: HTMLInputElement, button: HTMLDivElement) {
      const matches = getMatchingSecrets();
      if (matches.length === 0) {
        removeButton(input);
        return;
      }

      button.classList.add('openpass-has-secret');
      button.style.display = '';
      button.title = `OpenPass - 点击填充验证码 (${matches.length} 个密钥)`;
    }

    function updateAllButtons() {
      floatingButtons.forEach(({ button }, input) => {
        updateButtonState(input, button);
      });

      detectInputs();
    }

    function removeButton(input: HTMLInputElement) {
      const data = floatingButtons.get(input);
      if (!data) {
        return;
      }

      const { wrapper } = data;
      const parent = wrapper.parentNode;
      if (parent instanceof Node && wrapper.contains(input)) {
        parent.insertBefore(input, wrapper);
      }

      wrapper.remove();
      floatingButtons.delete(input);
      detectedInputs.delete(input);
    }

    function showToast(message: string, type = 'default') {
      const oldToast = document.querySelector('.openpass-toast');
      oldToast?.remove();

      const toast = document.createElement('div');
      toast.className = `openpass-toast openpass-toast-${type}`;
      toast.textContent = message;
      document.body.appendChild(toast);

      requestAnimationFrame(() => {
        toast.classList.add('openpass-toast-show');
      });

      window.setTimeout(() => {
        toast.classList.remove('openpass-toast-show');
        window.setTimeout(() => toast.remove(), 300);
      }, 2000);
    }

    function init() {
      void fetchSecrets();

      chrome.storage.onChanged.addListener((changes) => {
        if (changes.secrets) {
          void fetchSecrets();
        }
      });

      observeUrlChange();
      startDetection();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
});
