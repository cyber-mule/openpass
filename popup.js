/**
 * 2FA Authenticator - 弹窗逻辑
 * 弹窗默认不需要认证，只有导入/导出等敏感操作需要密码验证
 */

class TwoFAApp {
  constructor() {
    this.secrets = [];
    this.currentTab = null;
    this.currentUrl = null;
    this.timers = new Map();
    this.codeData = new Map();
    this.pendingImportData = null;

    this.init();
  }

  async init() {
    // 检查是否已设置主密码
    const setupComplete = await this.checkSetup();
    if (!setupComplete) {
      this.showSetupPrompt();
      return;
    }

    // 弹窗无需认证，直接加载
    await this.loadSecrets();
    await this.getCurrentTab();
    this.loadVersionInfo();
    const hasPendingSecret = await this.checkPendingSecret();
    this.bindEvents();
    if (!hasPendingSecret) {
      this.showPage('homePage');
    }
  }

  /**
   * 检查是否已完成设置
   */
  async checkSetup() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['isSetupComplete'], (result) => {
        resolve(result.isSetupComplete === true);
      });
    });
  }

  /**
   * 显示设置提示
   */
  showSetupPrompt() {
    document.body.innerHTML = `
      <div class="setup-prompt">
        <div class="setup-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h2>欢迎使用 TOTPPass</h2>
        <p>请先设置主密码以保护你的密钥</p>
        <button id="goSetupBtn" class="btn-primary">设置主密码</button>
      </div>
    `;

    document.getElementById('goSetupBtn').addEventListener('click', () => {
      chrome.tabs.create({ url: 'setup.html' });
      window.close();
    });
  }

  /**
   * 获取会话密钥（不阻塞，返回 null 表示无会话）
   */
  async getSessionKey() {
    return await sessionManager.getSessionKey();
  }

  /**
   * 确保会话存在（用于需要密码的操作）
   */
  async ensureSession() {
    let key = await sessionManager.getSessionKey();
    if (key) return key;

    // 显示密码验证对话框
    return await this.showPasswordDialog();
  }

  /**
   * 显示密码验证对话框
   */
  showPasswordDialog() {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'password-dialog-overlay';
      modal.innerHTML = `
        <div class="password-dialog">
          <h3>验证主密码</h3>
          <form id="passwordDialogForm">
            <input type="password" id="dialogPassword" placeholder="输入主密码" autofocus>
            <p class="error" id="dialogError"></p>
            <div class="dialog-actions">
              <button type="button" class="btn-cancel" id="dialogCancel">取消</button>
              <button type="submit" class="btn-confirm">确认</button>
            </div>
          </form>
        </div>
      `;

      document.body.appendChild(modal);

      const form = modal.querySelector('#passwordDialogForm');
      const input = modal.querySelector('#dialogPassword');
      const error = modal.querySelector('#dialogError');
      const cancelBtn = modal.querySelector('#dialogCancel');

      const close = (value) => {
        modal.remove();
        resolve(value);
      };

      cancelBtn.addEventListener('click', () => close(null));
      modal.addEventListener('click', (e) => {
        if (e.target === modal) close(null);
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = input.value;
        if (!password) return;

        try {
          const result = await chrome.storage.local.get(['masterPasswordHash', 'masterPasswordSalt']);
          const isValid = await CryptoUtils.verifyMasterPassword(
            password,
            result.masterPasswordHash,
            result.masterPasswordSalt
          );

          if (isValid) {
            await sessionManager.createSession(password);
            close(password);
          } else {
            error.textContent = '主密码错误';
            input.value = '';
            input.focus();
          }
        } catch (err) {
          error.textContent = '验证失败';
        }
      });

      input.focus();
    });
  }

  /**
   * 加载版本信息
   */
  loadVersionInfo() {
    const manifest = chrome.runtime.getManifest();

    // 更新版本号（元素可能在关于页面中）
    const versionEl = document.getElementById('popupVersion');
    if (versionEl) {
      versionEl.textContent = `v${manifest.version}`;
    }

    // 更新构建时间
    const buildTimeEl = document.getElementById('popupBuildTime');
    if (buildTimeEl) {
      buildTimeEl.textContent = manifest.build_time || '开发模式';
    }

    // 更新 commit hash
    const commitHash = manifest.commit_hash || 'dev';
    const hashElement = document.getElementById('popupCommitHash');
    if (hashElement) {
      hashElement.textContent = commitHash.substring(0, 7);

      // 点击复制完整 hash
      if (commitHash !== 'dev') {
        hashElement.title = '点击复制完整 hash';
        hashElement.addEventListener('click', async () => {
          await this.copyToClipboard(commitHash);
          this.showToast('Commit hash 已复制', 'success');
        });
      }
    }
  }

  /**
   * 检查是否有待添加的密钥（来自右键菜单解析）
   */
  async checkPendingSecret() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['pendingSecret'], async (result) => {
        if (result.pendingSecret) {
          const secret = result.pendingSecret;
          // 清除待添加的密钥
          await chrome.storage.local.remove(['pendingSecret']);

          // 显示添加页面并预填充
          this.showPage('createPage');
          setTimeout(() => {
            this.prefillSecret(secret);
          }, 100);
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  }

  /**
   * 预填充密钥表单
   */
  prefillSecret(secret) {
    document.getElementById('secretInput').value = secret.secret || '';
    document.getElementById('siteInput').value = secret.site || '';
    document.getElementById('nameInput').value = secret.name || '';
    document.getElementById('digitsInput').value = '6';

    // 触发验证
    const event = new Event('input');
    document.getElementById('secretInput').dispatchEvent(event);
  }

  /**
   * 从 storage 加载密钥（明文存储）
   */
  async loadSecrets() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['secrets'], (result) => {
        this.secrets = result.secrets || [];
        resolve();
      });
    });
  }

  /**
   * 保存密钥到 storage（明文存储）
   */
  async saveSecrets() {
    // 同时保存站点列表（用于 badge 显示）
    const sitesList = this.secrets.map(s => ({ site: s.site }));

    return new Promise((resolve) => {
      chrome.storage.local.set({
        secrets: this.secrets,
        sitesList: sitesList
      }, resolve);
    });
  }

  /**
   * 获取当前标签页 URL
   */
  async getCurrentTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          this.currentTab = tabs[0];
          this.currentUrl = tabs[0].url;
        }
        resolve();
      });
    });
  }

  /**
   * 解析 URL 获取域名信息
   */
  parseUrl(url) {
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
  matchSecrets(url) {
    const urlInfo = this.parseUrl(url);
    if (!urlInfo) return [];

    const matches = [];

    for (const secret of this.secrets) {
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
        matches.push({
          ...secret,
          matchType,
          priority: ['fullUrl', 'fullDomain', 'mainDomain', 'contains'].indexOf(matchType)
        });
      }
    }

    matches.sort((a, b) => a.priority - b.priority);
    return matches;
  }

  /**
   * 显示页面
   */
  showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => {
      page.classList.toggle('active', page.id === pageId);
    });

    if (pageId === 'homePage') {
      this.renderHomePage();
    } else if (pageId === 'createPage') {
      this.initCreateForm();
    }
  }

  /**
   * 渲染主页
   */
  async renderHomePage() {
    // 清除所有计时器
    this.clearAllTimers();

    // 清空搜索框
    document.getElementById('searchInput').value = '';

    // 渲染当前网站匹配
    await this.renderCurrentSiteMatch();

    // 更新主页状态（默认不展示所有密钥）
    this.updateHomeState();
  }

  /**
   * 清除所有计时器
   */
  clearAllTimers() {
    this.timers.forEach(timer => clearInterval(timer));
    this.timers.clear();
  }

  /**
   * 渲染当前网站匹配
   */
  async renderCurrentSiteMatch() {
    const container = document.getElementById('currentSiteMatch');
    const codesContainer = document.getElementById('currentSiteCodes');

    if (!this.currentUrl) {
      container.classList.add('hidden');
      return;
    }

    const matches = this.matchSecrets(this.currentUrl);

    if (matches.length === 0) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    codesContainer.innerHTML = '';

    for (const secret of matches) {
      const card = await this.createSecretCard(secret, true);
      codesContainer.appendChild(card);
    }
  }

  /**
   * 更新主页状态
   */
  updateHomeState() {
    const defaultState = document.getElementById('defaultState');
    const emptyState = document.getElementById('emptyState');
    const searchResults = document.getElementById('searchResults');
    const totalSecretsCount = document.getElementById('totalSecretsCount');

    // 更新统计数字
    totalSecretsCount.textContent = this.secrets.length;

    // 隐藏搜索结果
    searchResults.classList.add('hidden');

    // 根据密钥数量显示不同状态
    if (this.secrets.length === 0) {
      defaultState.classList.add('hidden');
      emptyState.classList.remove('hidden');
    } else {
      defaultState.classList.remove('hidden');
      emptyState.classList.add('hidden');
    }
  }

  /**
   * 渲染搜索结果
   */
  renderSearchResults(filter) {
    const searchResults = document.getElementById('searchResults');
    const searchResultsList = document.getElementById('searchResultsList');
    const searchCount = document.getElementById('searchCount');
    const noSearchResult = document.getElementById('noSearchResult');
    const defaultState = document.getElementById('defaultState');

    // 如果搜索框为空，隐藏搜索结果，显示默认状态
    if (!filter) {
      searchResults.classList.add('hidden');
      defaultState.classList.remove('hidden');
      return;
    }

    // 隐藏默认状态，显示搜索结果
    defaultState.classList.add('hidden');
    searchResults.classList.remove('hidden');

    // 过滤密钥
    const lowerFilter = filter.toLowerCase();
    const filteredSecrets = this.secrets.filter(s =>
      (s.name && s.name.toLowerCase().includes(lowerFilter)) ||
      s.site.toLowerCase().includes(lowerFilter)
    );

    // 更新计数
    searchCount.textContent = filteredSecrets.length;

    // 清空列表
    searchResultsList.innerHTML = '';

    // 显示/隐藏无结果提示
    if (filteredSecrets.length === 0) {
      noSearchResult.classList.remove('hidden');
      searchResultsList.classList.add('hidden');
    } else {
      noSearchResult.classList.add('hidden');
      searchResultsList.classList.remove('hidden');

      // 渲染列表
      filteredSecrets.forEach(async (secret) => {
        const card = await this.createSecretCard(secret, false);
        searchResultsList.appendChild(card);
      });
    }
  }

  /**
   * 渲染所有密钥列表（保留兼容性）
   */
  renderAllSecrets(filter = '') {
    this.renderSearchResults(filter);
  }

  /**
   * 创建密钥卡片
   */
  async createSecretCard(secret, isCurrentSite) {
    const card = document.createElement('div');
    card.className = 'secret-card';
    card.dataset.id = secret.id;

    const result = await TOTP.generate(secret.secret, secret.digits);
    this.codeData.set(secret.id, result.code);

    const formatClass = secret.digits === 8 ? 'format-8' : 'format-6';
    const formattedCode = this.formatCode(result.code);

    card.innerHTML = `
      <div class="secret-card-header">
        <div class="secret-card-info">
          <div class="secret-card-name">${secret.name || secret.site}</div>
          <div class="secret-card-site">${secret.site}</div>
        </div>
        <div class="secret-card-menu">
          <button class="menu-btn edit" title="编辑">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="menu-btn delete" title="删除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="secret-card-code">
        <span class="otp-display ${formatClass}" data-id="${secret.id}">${formattedCode}</span>
        <span class="timer-mini" data-id="${secret.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span class="timer-text">${result.remainingSeconds}s</span>
        </span>
      </div>
    `;

    // 点击复制验证码
    card.addEventListener('click', async (e) => {
      // 如果点击的是菜单按钮，不触发复制
      if (e.target.closest('.menu-btn')) return;

      const code = this.codeData.get(secret.id);
      if (code) {
        await this.copyToClipboard(code);
        this.showToast('验证码已复制', 'success');
        card.classList.add('copied');
        setTimeout(() => card.classList.remove('copied'), 1000);
      }
    });

    // 编辑按钮
    card.querySelector('.menu-btn.edit').addEventListener('click', (e) => {
      e.stopPropagation();
      this.showEditPage(secret);
    });

    // 删除按钮
    card.querySelector('.menu-btn.delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`确定要删除 "${secret.name || secret.site}" 吗？`)) {
        this.secrets = this.secrets.filter(s => s.id !== secret.id);
        await this.saveSecrets();
        this.showToast('密钥已删除');
        this.renderHomePage();
      }
    });

    // 启动计时器
    this.startCardTimer(secret, card);

    return card;
  }

  /**
   * 格式化验证码显示
   */
  formatCode(code) {
    if (code.length === 6) {
      return code.slice(0, 3) + ' ' + code.slice(3);
    } else if (code.length === 8) {
      return code.slice(0, 4) + ' ' + code.slice(4);
    }
    return code;
  }

  /**
   * 启动卡片计时器
   */
  startCardTimer(secret, card) {
    const timerId = setInterval(async () => {
      const result = await TOTP.generate(secret.secret, secret.digits);
      this.codeData.set(secret.id, result.code);

      const otpDisplay = card.querySelector('.otp-display');
      const timerMini = card.querySelector('.timer-mini');
      const timerText = timerMini.querySelector('.timer-text');

      otpDisplay.textContent = this.formatCode(result.code);
      timerText.textContent = `${result.remainingSeconds}s`;

      // 更新计时器样式
      timerMini.classList.remove('warning', 'danger');
      if (result.remainingSeconds <= 5) {
        timerMini.classList.add('danger');
      } else if (result.remainingSeconds <= 10) {
        timerMini.classList.add('warning');
      }
    }, 1000);

    this.timers.set(secret.id, timerId);
  }

  /**
   * 显示编辑页面
   */
  showEditPage(secret) {
    document.querySelectorAll('.page').forEach(page => {
      page.classList.remove('active');
    });
    document.getElementById('editPage').classList.add('active');

    document.getElementById('editId').value = secret.id;
    document.getElementById('editSecretInput').value = secret.secret;
    document.getElementById('editDigitsInput').value = secret.digits;
    document.getElementById('editSiteInput').value = secret.site;
    document.getElementById('editNameInput').value = secret.name || '';
    document.getElementById('editSecretError').textContent = '';
  }

  /**
   * 初始化创建表单
   */
  initCreateForm() {
    const siteInput = document.getElementById('siteInput');

    if (this.currentUrl) {
      const urlInfo = this.parseUrl(this.currentUrl);
      if (urlInfo) {
        siteInput.value = urlInfo.fullDomain;
      }
    }

    document.getElementById('secretInput').value = '';
    document.getElementById('nameInput').value = '';
    document.getElementById('secretError').textContent = '';
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    // 添加按钮
    document.getElementById('addBtn').addEventListener('click', () => {
      this.showPage('createPage');
    });

    // 快捷添加按钮
    document.getElementById('quickAddBtn').addEventListener('click', () => {
      this.showPage('createPage');
    });

    // 快捷管理按钮
    document.getElementById('quickManagerBtn').addEventListener('click', () => {
      chrome.tabs.create({ url: 'manager.html' });
    });

    // 返回按钮
    document.getElementById('backBtn').addEventListener('click', () => {
      this.showPage('homePage');
    });

    document.getElementById('editBackBtn').addEventListener('click', () => {
      this.showPage('homePage');
    });

    // 搜索
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.renderSearchResults(e.target.value.trim());
    });

    // 创建表单
    document.getElementById('createForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.createSecret();
    });

    // 编辑表单
    document.getElementById('editForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.updateSecret();
    });

    // 删除按钮
    document.getElementById('deleteBtn').addEventListener('click', async () => {
      const id = document.getElementById('editId').value;
      const secret = this.secrets.find(s => s.id === id);
      if (secret && confirm(`确定要删除 "${secret.name || secret.site}" 吗？`)) {
        this.secrets = this.secrets.filter(s => s.id !== id);
        await this.saveSecrets();
        this.showToast('密钥已删除');
        this.showPage('homePage');
      }
    });

    // 密钥输入验证
    document.getElementById('secretInput').addEventListener('input', (e) => {
      const value = e.target.value.toUpperCase().replace(/[^A-Z2-7]/g, '');
      e.target.value = value;

      const error = document.getElementById('secretError');
      if (value && !TOTP.isValidSecret(value)) {
        error.textContent = '密钥格式无效（至少需要 16 个字符）';
      } else {
        error.textContent = '';
      }
    });

    document.getElementById('editSecretInput').addEventListener('input', (e) => {
      const value = e.target.value.toUpperCase().replace(/[^A-Z2-7]/g, '');
      e.target.value = value;

      const error = document.getElementById('editSecretError');
      if (value && !TOTP.isValidSecret(value)) {
        error.textContent = '密钥格式无效（至少需要 16 个字符）';
      } else {
        error.textContent = '';
      }
    });

    // 下拉菜单
    this.bindDropdownEvents();

    // 备份恢复
    this.bindBackupEvents();
  }

  /**
   * 绑定下拉菜单事件
   */
  bindDropdownEvents() {
    const menuBtn = document.getElementById('menuBtn');
    const dropdownMenu = document.getElementById('dropdownMenu');

    // 点击菜单按钮切换显示
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('hidden');
    });

    // 点击其他地方关闭菜单
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown')) {
        dropdownMenu.classList.add('hidden');
      }
    });
  }

  /**
   * 绑定备份恢复事件
   */
  bindBackupEvents() {
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const fileInput = document.getElementById('fileInput');
    const restoreModal = document.getElementById('restoreModal');
    const mergeBtn = document.getElementById('mergeBtn');
    const overwriteBtn = document.getElementById('overwriteBtn');
    const cancelRestoreBtn = document.getElementById('cancelRestoreBtn');
    const modalOverlay = restoreModal.querySelector('.modal-overlay');

    // 导出
    exportBtn.addEventListener('click', () => {
      document.getElementById('dropdownMenu').classList.add('hidden');
      this.exportSecrets();
    });

    // 导入
    importBtn.addEventListener('click', async () => {
      document.getElementById('dropdownMenu').classList.add('hidden');

      // 验证密码
      await this.verifyPasswordForAction('导入', async () => {
        fileInput.click();
      });
    });

    // 文件选择
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        // 验证数据格式
        if (!this.validateBackupData(data)) {
          this.showToast('备份文件格式无效');
          return;
        }

        // 存储待导入数据
        this.pendingImportData = data.secrets;

        // 显示恢复选项对话框
        document.getElementById('importCount').textContent = data.secrets.length;
        document.getElementById('currentCount').textContent = this.secrets.length;
        restoreModal.classList.remove('hidden');

      } catch (err) {
        console.error('导入失败:', err);
        this.showToast('导入失败，请检查文件格式');
      }

      // 清空文件输入
      fileInput.value = '';
    });

    // 合并
    mergeBtn.addEventListener('click', async () => {
      if (!this.pendingImportData) return;

      await this.mergeSecrets(this.pendingImportData);
      this.pendingImportData = null;
      restoreModal.classList.add('hidden');
    });

    // 覆盖
    overwriteBtn.addEventListener('click', async () => {
      if (!this.pendingImportData) return;

      if (confirm('覆盖将删除所有现有密钥，确定继续吗？')) {
        await this.overwriteSecrets(this.pendingImportData);
        this.pendingImportData = null;
        restoreModal.classList.add('hidden');
      }
    });

    // 取消
    cancelRestoreBtn.addEventListener('click', () => {
      this.pendingImportData = null;
      restoreModal.classList.add('hidden');
    });

    // 点击遮罩关闭
    modalOverlay.addEventListener('click', () => {
      this.pendingImportData = null;
      restoreModal.classList.add('hidden');
    });

    // 关于
    const aboutBtn = document.getElementById('aboutBtn');
    const aboutModal = document.getElementById('aboutModal');
    const closeAboutBtn = document.getElementById('closeAboutBtn');
    const aboutModalOverlay = aboutModal.querySelector('.modal-overlay');

    aboutBtn.addEventListener('click', () => {
      document.getElementById('dropdownMenu').classList.add('hidden');
      aboutModal.classList.remove('hidden');
    });

    closeAboutBtn.addEventListener('click', () => {
      aboutModal.classList.add('hidden');
    });

    aboutModalOverlay.addEventListener('click', () => {
      aboutModal.classList.add('hidden');
    });

    // 打开管理页面
    const openManagerBtn = document.getElementById('openManagerBtn');
    openManagerBtn.addEventListener('click', () => {
      document.getElementById('dropdownMenu').classList.add('hidden');
      chrome.runtime.openOptionsPage();
      window.close();
    });
  }

  /**
   * 验证备份数据格式
   */
  validateBackupData(data) {
    if (!data || typeof data !== 'object') return false;
    if (!Array.isArray(data.secrets)) return false;

    for (const secret of data.secrets) {
      if (!secret.secret || !secret.site) return false;
      if (typeof secret.secret !== 'string' || typeof secret.site !== 'string') return false;
    }

    return true;
  }

  /**
   * 验证密码（用于敏感操作）
   */
  async verifyPasswordForAction(actionName, callback) {
    // 确保会话存在
    const sessionKey = await this.ensureSession();
    if (sessionKey) {
      await callback(sessionKey);
    }
  }

  /**
   * 导出密钥
   */
  async exportSecrets() {
    if (this.secrets.length === 0) {
      this.showToast('没有可导出的密钥');
      return;
    }

    // 验证密码
    await this.verifyPasswordForAction('导出', async () => {
      const backupData = {
        version: '1.0',
        exportTime: new Date().toISOString(),
        count: this.secrets.length,
        secrets: this.secrets
      };

      const json = JSON.stringify(backupData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `totppass-backup-${timestamp}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.showToast(`已导出 ${this.secrets.length} 个密钥`, 'success');
    });
  }

  /**
   * 合并密钥
   */
  async mergeSecrets(importSecrets) {
    let addedCount = 0;
    let skippedCount = 0;

    for (const secret of importSecrets) {
      // 检查是否已存在相同站点
      const exists = this.secrets.some(s => s.site.toLowerCase() === secret.site.toLowerCase());

      if (!exists) {
        // 生成新 ID
        const newSecret = {
          ...secret,
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          importedAt: new Date().toISOString()
        };
        this.secrets.push(newSecret);
        addedCount++;
      } else {
        skippedCount++;
      }
    }

    await this.saveSecrets();
    this.renderHomePage();

    if (skippedCount > 0) {
      this.showToast(`已导入 ${addedCount} 个，跳过 ${skippedCount} 个重复`, 'success');
    } else {
      this.showToast(`已导入 ${addedCount} 个密钥`, 'success');
    }
  }

  /**
   * 覆盖密钥
   */
  async overwriteSecrets(importSecrets) {
    // 重新生成 ID
    this.secrets = importSecrets.map(secret => ({
      ...secret,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      importedAt: new Date().toISOString()
    }));

    await this.saveSecrets();
    this.renderHomePage();
    this.showToast(`已导入 ${this.secrets.length} 个密钥`, 'success');
  }

  /**
   * 创建密钥
   */
  async createSecret() {
    const secret = document.getElementById('secretInput').value.trim().toUpperCase();
    const digits = parseInt(document.getElementById('digitsInput').value);
    const site = document.getElementById('siteInput').value.trim().toLowerCase();
    const name = document.getElementById('nameInput').value.trim();

    if (!TOTP.isValidSecret(secret)) {
      document.getElementById('secretError').textContent = '密钥格式无效（至少需要 16 个字符）';
      return;
    }

    if (!site) {
      this.showToast('请输入目标站点');
      return;
    }

    // 允许同站点多个密钥
    const newSecret = {
      id: Date.now().toString(),
      secret,
      digits,
      site,
      name,
      createdAt: new Date().toISOString()
    };

    this.secrets.push(newSecret);
    await this.saveSecrets();

    this.showToast('密钥已保存', 'success');
    this.showPage('homePage');
  }

  /**
   * 更新密钥
   */
  async updateSecret() {
    const id = document.getElementById('editId').value;
    const secret = document.getElementById('editSecretInput').value.trim().toUpperCase();
    const digits = parseInt(document.getElementById('editDigitsInput').value);
    const site = document.getElementById('editSiteInput').value.trim().toLowerCase();
    const name = document.getElementById('editNameInput').value.trim();

    if (!TOTP.isValidSecret(secret)) {
      document.getElementById('editSecretError').textContent = '密钥格式无效（至少需要 16 个字符）';
      return;
    }

    if (!site) {
      this.showToast('请输入目标站点');
      return;
    }

    const index = this.secrets.findIndex(s => s.id === id);
    if (index === -1) {
      this.showToast('密钥不存在');
      return;
    }

    // 允许同站点多个密钥，直接更新
    this.secrets[index] = {
      ...this.secrets[index],
      secret,
      digits,
      site,
      name,
      updatedAt: new Date().toISOString()
    };

    await this.saveSecrets();
    this.showToast('密钥已更新', 'success');
    this.showPage('homePage');
  }

  /**
   * 复制到剪贴板
   */
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    }
  }

  /**
   * 显示 Toast 提示
   */
  showToast(message, type = 'default') {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.remove('success');
    if (type === 'success') {
      toast.classList.add('success');
    }

    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  new TwoFAApp();
});