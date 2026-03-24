/**
 * OpenPass - Manager Page Logic
 * 管理页面需要认证，15分钟无操作超时
 */

// 导入备份管理器
// eslint-disable-next-line no-unused-vars
const backupManager = new BackupManager();

class ManagerApp {
  constructor() {
    this.secrets = [];
    this.timers = new Map();
    this.codeData = new Map();
    this.pendingImportData = null;
    this.isAuthenticated = false;

    this.init();
  }

  async init() {
    // 检查是否已完成引导
    const guideStatus = await this.checkGuideStatus();

    if (!guideStatus.hasPassword) {
      // 没有设置主密码，显示欢迎引导（步骤1：设置主密码）
      this.showWelcomeGuide(guideStatus);
      return;
    }

    // 已设置主密码，检查会话
    if (!await sessionManager.isAuthenticated()) {
      window.location.href = 'auth.html?redirect=manager.html';
      return;
    }

    this.isAuthenticated = true;

    // 更新活动时间
    await sessionManager.updateActivity();

    // 设置活动监听
    this.setupActivityListener();

    await this.loadSecrets();
    this.loadVersionSignature();
    this.bindEvents();
    this.renderSecretsTable();
    this.startTimers();

    // 检查是否需要显示欢迎引导（跳过步骤1）
    if (!guideStatus.welcomeCompleted) {
      this.showWelcomeGuide(guideStatus);
    }
  }

  /**
   * 检查引导状态
   */
  async checkGuideStatus() {
    const result = await chrome.storage.local.get([
      'masterPasswordHash',
      'secrets',
      'enableAutoBackup',
      'welcomeCompleted'
    ]);

    return {
      hasPassword: !!result.masterPasswordHash,
      hasSecrets: result.secrets && result.secrets.length > 0,
      hasBackup: !!result.enableAutoBackup,
      welcomeCompleted: !!result.welcomeCompleted
    };
  }

  /**
   * 显示欢迎引导
   */
  showWelcomeGuide(status) {
    const modal = document.getElementById('welcomeModal');
    const startUsingBtn = document.getElementById('startUsingBtn');
    const skipBtn = document.getElementById('skipWelcomeBtn');

    // 更新步骤状态
    this.updateWelcomeStep(1, status.hasPassword);
    this.updateWelcomeStep(2, status.hasSecrets);
    this.updateWelcomeStep(3, status.hasBackup);

    // 根据完成状态决定展开哪个步骤
    const step1Body = document.getElementById('step1Body');
    const step2Body = document.getElementById('step2Body');
    const step3Body = document.getElementById('step3Body');

    // 先折叠所有
    step1Body.classList.add('collapsed');
    step2Body.classList.add('collapsed');
    step3Body.classList.add('collapsed');

    if (!status.hasPassword) {
      // 步骤1未完成，展开步骤1
      step1Body.classList.remove('collapsed');
      startUsingBtn.disabled = true;
      skipBtn.style.display = 'none';
    } else if (!status.hasSecrets) {
      // 步骤1完成，步骤2未完成，展开步骤2
      step2Body.classList.remove('collapsed');
      startUsingBtn.disabled = false;
      skipBtn.style.display = '';
    } else if (!status.hasBackup) {
      // 步骤1、2完成，步骤3未完成，展开步骤3
      step3Body.classList.remove('collapsed');
      startUsingBtn.disabled = false;
      skipBtn.style.display = '';
    } else {
      // 全部完成
      startUsingBtn.disabled = false;
      skipBtn.style.display = '';
    }

    // 显示模态框
    modal.classList.remove('hidden');

    // 绑定事件
    this.bindWelcomeEvents();
  }

  /**
   * 更新欢迎步骤状态
   */
  updateWelcomeStep(step, completed) {
    const stepEl = document.querySelector(`.welcome-step[data-step="${step}"]`);
    const statusEl = document.getElementById(`step${step}Status`);
    const bodyEl = document.getElementById(`step${step}Body`);

    if (completed) {
      stepEl.classList.add('completed');
      statusEl.textContent = '已完成';
      statusEl.classList.remove('required');
      if (bodyEl) bodyEl.classList.add('collapsed');
    } else {
      stepEl.classList.remove('completed');
      if (step === 1) {
        statusEl.textContent = '必填';
        statusEl.classList.add('required');
      } else {
        statusEl.textContent = '推荐';
        statusEl.classList.remove('required');
      }
    }
  }

  /**
   * 绑定欢迎引导事件
   */
  bindWelcomeEvents() {
    const modal = document.getElementById('welcomeModal');
    const skipBtn = document.getElementById('skipWelcomeBtn');
    const startBtn = document.getElementById('startUsingBtn');
    const welcomeSetPasswordBtn = document.getElementById('welcomeSetPasswordBtn');
    const addFirstSecretBtn = document.getElementById('addFirstSecretBtn');
    const setupBackupBtn = document.getElementById('setupBackupBtn');

    // 清除旧的事件监听器
    const newSkipBtn = skipBtn.cloneNode(true);
    skipBtn.parentNode.replaceChild(newSkipBtn, skipBtn);
    const newStartBtn = startBtn.cloneNode(true);
    startBtn.parentNode.replaceChild(newStartBtn, startBtn);
    const newWelcomeSetPasswordBtn = welcomeSetPasswordBtn.cloneNode(true);
    welcomeSetPasswordBtn.parentNode.replaceChild(newWelcomeSetPasswordBtn, welcomeSetPasswordBtn);
    const newAddFirstSecretBtn = addFirstSecretBtn.cloneNode(true);
    addFirstSecretBtn.parentNode.replaceChild(newAddFirstSecretBtn, addFirstSecretBtn);
    const newSetupBackupBtn = setupBackupBtn.cloneNode(true);
    setupBackupBtn.parentNode.replaceChild(newSetupBackupBtn, setupBackupBtn);

    // 跳过
    newSkipBtn.addEventListener('click', async () => {
      await chrome.storage.local.set({ welcomeCompleted: true });
      modal.classList.add('hidden');
    });

    // 开始使用
    newStartBtn.addEventListener('click', async () => {
      await chrome.storage.local.set({ welcomeCompleted: true });
      modal.classList.add('hidden');
    });

    // 设置主密码
    newWelcomeSetPasswordBtn.addEventListener('click', async () => {
      await this.handleWelcomeSetPassword();
    });

    // 添加第一个密钥
    newAddFirstSecretBtn.addEventListener('click', async () => {
      modal.classList.add('hidden');
      this.showSecretModal();
    });

    // 配置自动备份
    newSetupBackupBtn.addEventListener('click', async () => {
      modal.classList.add('hidden');
      this.showPage('settings');
      setTimeout(() => {
        const autoBackupSection = document.querySelector('.settings-section:nth-child(3)');
        if (autoBackupSection) {
          autoBackupSection.scrollIntoView({ behavior: 'smooth' });
        }
      }, 100);
    });
  }

  /**
   * 处理欢迎引导中设置主密码
   */
  async handleWelcomeSetPassword() {
    const submitBtn = document.getElementById('welcomeSetPasswordBtn');
    const errorEl = document.getElementById('welcomePasswordError');

    // 防止重复提交
    if (submitBtn.disabled) {
      return;
    }

    const password = document.getElementById('welcomePassword').value;
    const confirmPassword = document.getElementById('welcomePasswordConfirm').value;

    // 验证
    if (!password) {
      errorEl.textContent = '请输入主密码';
      return;
    }

    if (password.length < 6) {
      errorEl.textContent = '密码至少需要 6 个字符';
      return;
    }

    if (password !== confirmPassword) {
      errorEl.textContent = '两次输入的密码不一致';
      return;
    }

    // 显示加载状态
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = '设置中...';

    try {
      // 创建密码哈希
      const { hash, salt } = await CryptoUtils.createMasterPasswordHash(password);

      // 保存（使用正确的 key）
      await chrome.storage.local.set({
        masterPasswordHash: hash,
        masterPasswordSalt: salt,
        isSetupComplete: true
      });

      // 创建会话
      await sessionManager.createSession(password);

      // 标记已认证
      this.isAuthenticated = true;

      // 更新步骤状态
      this.updateWelcomeStep(1, true);

      // 展开步骤2
      document.getElementById('step1Body').classList.add('collapsed');
      document.getElementById('step2Body').classList.remove('collapsed');

      // 启用开始使用按钮
      document.getElementById('startUsingBtn').disabled = false;
      document.getElementById('skipWelcomeBtn').style.display = '';

      // 清空表单
      document.getElementById('welcomePassword').value = '';
      document.getElementById('welcomePasswordConfirm').value = '';
      errorEl.textContent = '';

      // 初始化管理功能（如果还没有初始化）
      if (!this.secrets.length) {
        await this.loadSecrets();
        this.loadVersionSignature();
        this.bindEvents();
        this.renderSecretsTable();
        this.startTimers();
        this.setupActivityListener();
      }

      this.showToast('主密码设置成功', 'success');
    } catch (error) {
      console.error('设置主密码失败:', error);
      errorEl.textContent = '设置失败，请重试';
    } finally {
      // 恢复按钮状态
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }

  /**
   * 刷新欢迎引导状态
   */
  async refreshWelcomeStatus() {
    const settings = await chrome.storage.local.get([
      'masterPasswordHash',
      'secrets',
      'enableAutoBackup',
      'welcomeCompleted'
    ]);

    const hasPassword = !!settings.masterPasswordHash;
    const hasSecrets = settings.secrets && settings.secrets.length > 0;
    const hasBackup = !!settings.enableAutoBackup;

    // 更新步骤状态
    this.updateWelcomeStep(1, hasPassword);
    this.updateWelcomeStep(2, hasSecrets);
    this.updateWelcomeStep(3, hasBackup);

    // 更新按钮状态
    const startUsingBtn = document.getElementById('startUsingBtn');
    if (startUsingBtn) {
      startUsingBtn.disabled = !hasPassword;
    }

    // 如果都已完成，标记为已完成
    if (hasPassword && hasSecrets && hasBackup) {
      await chrome.storage.local.set({ welcomeCompleted: true });
      return;
    }

    // 如果引导未完成，更新 UI 并展开下一步
    if (!settings.welcomeCompleted) {
      const modal = document.getElementById('welcomeModal');
      const step1Body = document.getElementById('step1Body');
      const step2Body = document.getElementById('step2Body');
      const step3Body = document.getElementById('step3Body');

      // 折叠所有
      step1Body?.classList.add('collapsed');
      step2Body?.classList.add('collapsed');
      step3Body?.classList.add('collapsed');

      // 展开下一个未完成的步骤
      if (!hasPassword) {
        step1Body?.classList.remove('collapsed');
      } else if (!hasSecrets) {
        step2Body?.classList.remove('collapsed');
      } else if (!hasBackup) {
        step3Body?.classList.remove('collapsed');
      }

      // 如果模态框是隐藏的，重新显示
      if (modal && modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
      }
    }
  }

  /**
   * 设置活动监听（用户操作时延长超时）
   */
  setupActivityListener() {
    // 用户交互时更新活动时间
    const updateActivity = () => sessionManager.updateActivity();

    document.addEventListener('click', updateActivity);
    document.addEventListener('keydown', updateActivity);
    document.addEventListener('mousemove', updateActivity, { passive: true });

    // 页面可见时检查会话
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        if (!await sessionManager.isAuthenticated()) {
          window.location.href = 'auth.html?redirect=manager.html';
        }
      }
    });
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
   * 获取会话密钥
   */
  async getSessionKey() {
    return await sessionManager.getSessionKey();
  }

  /**
   * 加载版本签名信息
   */
  loadVersionSignature() {
    const manifest = chrome.runtime.getManifest();
    const version = `v${manifest.version}`;

    document.getElementById('versionNumber').textContent = version;
    document.getElementById('sidebarVersion').textContent = version;

    const extensionId = chrome.runtime.id;
    document.getElementById('extensionId').textContent = extensionId;

    const buildTime = manifest.build_time || '开发模式';
    document.getElementById('buildTime').textContent = buildTime;

    const commitHash = manifest.commit_hash || 'dev';
    const hashElement = document.getElementById('commitHash');
    hashElement.textContent = commitHash.substring(0, 7);

    if (commitHash !== 'dev') {
      hashElement.title = '点击复制完整 hash';
      hashElement.addEventListener('click', async () => {
        await this.copyToClipboard(commitHash);
        this.showToast('Commit hash 已复制', 'success');
      });
    }
  }

  /**
   * 加载密钥（明文存储）
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
   * 保存密钥（明文存储）
   */
  async saveSecrets() {
    // 同时保存站点列表（用于 badge 显示）
    const sitesList = this.secrets.map(s => ({ site: s.site }));

    return new Promise((resolve) => {
      chrome.storage.local.set({
        secrets: this.secrets,
        sitesList: sitesList
      }, () => {
        // 数据变化后异步备份，不阻塞
        this.autoBackupOnChange().catch(err => console.error('自动备份失败:', err));
        resolve();
      });
    });
  }

  /**
   * 数据变化时自动备份（异步执行，不阻塞主流程）
   */
  async autoBackupOnChange() {
    const settings = await autoBackupManager.getSettings();

    if (!settings.localSnapshot) {
      return;
    }

    // 获取加密设置
    const encryptionSettings = await backupManager.getEncryptionSettings();
    let password = null;

    if (encryptionSettings.enabled) {
      if (encryptionSettings.useMasterPassword) {
        password = await this.getSessionKey();
      } else if (encryptionSettings.encryptedPassword) {
        const sessionKey = await this.getSessionKey();
        if (sessionKey) {
          password = await CryptoUtils.decrypt(encryptionSettings.encryptedPassword, sessionKey);
        }
      }
    }

    // 触发备份（带防抖，异步执行）
    autoBackupManager.triggerChangeBackup(this.secrets, { password }).catch(err => {
      console.error('自动备份失败:', err);
    });
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    // 导航
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        this.showPage(page);
      });
    });

    // 搜索
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.renderSecretsTable(e.target.value.trim());
    });

    // 添加密钥按钮
    document.getElementById('addSecretBtn').addEventListener('click', () => {
      this.showSecretModal();
    });

    // 密钥表单提交
    document.getElementById('secretForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveSecret();
    });

    // 关闭模态框
    document.getElementById('closeModalBtn').addEventListener('click', () => {
      this.hideSecretModal();
    });
    document.getElementById('cancelBtn').addEventListener('click', () => {
      this.hideSecretModal();
    });
    document.querySelector('#secretModal .modal-overlay').addEventListener('click', () => {
      this.hideSecretModal();
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

    // 导出
    document.getElementById('exportBtn').addEventListener('click', () => {
      this.exportSecrets();
    });

    // 导入
    document.getElementById('importBtn').addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });

    document.getElementById('fileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        let data = JSON.parse(text);

        // 验证备份格式
        const validationResult = backupManager.validateBackup(data);
        if (!validationResult.valid) {
          this.showToast(validationResult.error || '备份文件格式无效', 'error');
          return;
        }
        data = validationResult.data;

        // 存储备份数据供后续使用
        this.pendingBackupData = data;
        this.isEncryptedBackup = validationResult.encrypted;

        // 显示备份信息
        const backupInfo = document.getElementById('backupInfo');
        const compatibilityWarning = document.getElementById('compatibilityWarning');
        const decryptSection = document.getElementById('decryptSection');
        const importCountText = document.getElementById('importCountText');

        document.getElementById('backupAppVersion').textContent = `v${data.appVersion || '未知'}`;
        document.getElementById('backupExportTime').textContent = data.exportTime
          ? new Date(data.exportTime).toLocaleString('zh-CN')
          : '-';
        backupInfo.style.display = 'block';

        // 检查版本兼容性
        const compatibility = backupManager.checkCompatibility(data.appVersion || '0.0.0');

        if (compatibility.level === 'warning') {
          compatibilityWarning.textContent = compatibility.message;
          compatibilityWarning.style.display = 'block';
        } else if (compatibility.level === 'error') {
          this.showToast(compatibility.message, 'error');
          return;
        } else {
          compatibilityWarning.style.display = 'none';
        }

        // 处理加密备份
        if (validationResult.encrypted) {
          decryptSection.style.display = 'block';
          importCountText.style.display = 'none';
          document.getElementById('importCount').textContent = data.count || '?';
          document.getElementById('decryptPassword').value = '';
          document.getElementById('decryptError').style.display = 'none';
        } else {
          decryptSection.style.display = 'none';
          importCountText.style.display = 'block';
          // 如果需要迁移，先迁移数据
          if (compatibility.level === 'warning') {
            data = backupManager.migrateData(data);
            this.pendingBackupData = data;
          }
          this.pendingImportData = data.secrets;
          document.getElementById('importCount').textContent = this.pendingImportData.length;
        }

        document.getElementById('currentCount').textContent = this.secrets.length;
        document.getElementById('importModal').classList.remove('hidden');
      } catch (err) {
        console.error('导入失败:', err);
        this.showToast('导入失败，请检查文件格式', 'error');
      }

      e.target.value = '';
    });

    // 导入确认
    document.getElementById('confirmImportBtn').addEventListener('click', async () => {
      const confirmBtn = document.getElementById('confirmImportBtn');

      // 防止重复提交
      if (confirmBtn.disabled) {
        return;
      }

      let importData = this.pendingImportData;

      // 如果是加密备份，先解密
      if (this.isEncryptedBackup) {
        const password = document.getElementById('decryptPassword').value;
        if (!password) {
          document.getElementById('decryptError').textContent = '请输入备份密码';
          document.getElementById('decryptError').style.display = 'block';
          return;
        }

        // 显示加载状态
        confirmBtn.disabled = true;
        confirmBtn.textContent = '解密中...';

        try {
          const decryptedBackup = await backupManager.decryptBackup(this.pendingBackupData, password);
          if (!decryptedBackup) {
            document.getElementById('decryptError').textContent = '密码错误，解密失败';
            document.getElementById('decryptError').style.display = 'block';
            confirmBtn.disabled = false;
            confirmBtn.textContent = '导入';
            return;
          }

          // 检查版本兼容性并迁移
          const compatibility = backupManager.checkCompatibility(decryptedBackup.appVersion || '0.0.0');
          let data = decryptedBackup;
          if (compatibility.level === 'warning') {
            data = backupManager.migrateData(decryptedBackup);
          }

          importData = data.secrets;
        } catch (error) {
          document.getElementById('decryptError').textContent = '解密失败，请重试';
          document.getElementById('decryptError').style.display = 'block';
          confirmBtn.disabled = false;
          confirmBtn.textContent = '导入';
          return;
        }
      }

      if (!importData) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '导入';
        return;
      }

      // 显示加载状态
      confirmBtn.disabled = true;
      confirmBtn.textContent = '导入中...';

      try {
        const action = document.querySelector('input[name="duplicateAction"]:checked').value;
        await this.importSecrets(importData, action);
        this.pendingImportData = null;
        this.pendingBackupData = null;
        this.isEncryptedBackup = false;
        document.getElementById('importModal').classList.add('hidden');
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '导入';
      }
    });

    document.getElementById('cancelImportBtn').addEventListener('click', () => {
      this.pendingImportData = null;
      this.pendingBackupData = null;
      this.isEncryptedBackup = false;
      document.getElementById('importModal').classList.add('hidden');
    });

    document.querySelector('#importModal .modal-overlay').addEventListener('click', () => {
      this.pendingImportData = null;
      this.pendingBackupData = null;
      this.isEncryptedBackup = false;
      document.getElementById('importModal').classList.add('hidden');
    });

    // 修改主密码
    document.getElementById('changePasswordBtn').addEventListener('click', () => {
      this.showPasswordModal();
    });

    document.getElementById('closePasswordModalBtn').addEventListener('click', () => {
      this.hidePasswordModal();
    });

    document.getElementById('cancelPasswordBtn').addEventListener('click', () => {
      this.hidePasswordModal();
    });

    document.querySelector('#passwordModal .modal-overlay').addEventListener('click', () => {
      this.hidePasswordModal();
    });

    document.getElementById('passwordForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.changePassword();
    });

    // 密码强度检测
    document.getElementById('newPassword').addEventListener('input', (e) => {
      this.checkPasswordStrength(e.target.value);
    });

    document.getElementById('confirmNewPassword').addEventListener('input', () => {
      const newPwd = document.getElementById('newPassword').value;
      const confirmPwd = document.getElementById('confirmNewPassword').value;
      const error = document.getElementById('passwordError');
      if (confirmPwd && confirmPwd !== newPwd) {
        error.textContent = '两次输入的密码不一致';
      } else {
        error.textContent = '';
      }
    });

    // 备份加密设置
    this.initBackupEncryptionSettings();
  }

  /**
   * 初始化备份加密设置
   */
  async initBackupEncryptionSettings() {
    const enableEncryption = document.getElementById('enableBackupEncryption');
    const useMasterPassword = document.getElementById('useMasterPasswordForBackup');
    const backupPasswordSettings = document.getElementById('backupPasswordSettings');
    const customPasswordSection = document.getElementById('customBackupPasswordSection');
    const saveBackupPasswordBtn = document.getElementById('saveBackupPasswordBtn');

    // 加载当前设置
    const settings = await backupManager.getEncryptionSettings();
    enableEncryption.checked = settings.enabled;
    useMasterPassword.checked = settings.useMasterPassword;

    // 根据设置显示/隐藏子设置
    backupPasswordSettings.style.display = settings.enabled ? 'block' : 'none';
    customPasswordSection.style.display = settings.enabled && !settings.useMasterPassword ? 'block' : 'none';

    // 启用/禁用加密
    enableEncryption.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      backupPasswordSettings.style.display = enabled ? 'block' : 'none';
      customPasswordSection.style.display = enabled && !useMasterPassword.checked ? 'block' : 'none';

      await backupManager.saveEncryptionSettings({
        enabled,
        useMasterPassword: useMasterPassword.checked,
        encryptedPassword: settings.encryptedPassword
      });

      this.showToast(enabled ? '已启用备份加密' : '已禁用备份加密', 'success');
    });

    // 使用主密码/自定义密码切换
    useMasterPassword.addEventListener('change', async (e) => {
      const useMaster = e.target.checked;
      customPasswordSection.style.display = useMaster ? 'none' : 'block';

      await backupManager.saveEncryptionSettings({
        enabled: enableEncryption.checked,
        useMasterPassword: useMaster,
        encryptedPassword: settings.encryptedPassword
      });

      if (useMaster) {
        this.showToast('将使用主密码加密备份', 'success');
      }
    });

    // 保存自定义备份密码
    saveBackupPasswordBtn.addEventListener('click', async () => {
      const password = document.getElementById('backupPassword').value;
      const confirmPassword = document.getElementById('backupPasswordConfirm').value;

      if (!password || password.length < 6) {
        this.showToast('密码至少需要 6 个字符', 'error');
        return;
      }

      if (password !== confirmPassword) {
        this.showToast('两次输入的密码不一致', 'error');
        return;
      }

      // 获取会话密钥来加密备份密码
      const sessionKey = await this.getSessionKey();
      if (!sessionKey) {
        this.showToast('请先验证主密码', 'error');
        return;
      }

      // 加密备份密码后存储
      const encryptedPassword = await CryptoUtils.encrypt(password, sessionKey);

      await backupManager.saveEncryptionSettings({
        enabled: enableEncryption.checked,
        useMasterPassword: false,
        encryptedPassword: encryptedPassword
      });

      // 清空输入
      document.getElementById('backupPassword').value = '';
      document.getElementById('backupPasswordConfirm').value = '';

      this.showToast('备份密码已保存', 'success');
    });

    // 自动备份设置
    this.initAutoBackupSettings();

    // 清空密钥
    document.getElementById('clearSecretsBtn').addEventListener('click', () => {
      this.showClearSecretsDialog();
    });

    // 重置所有数据
    document.getElementById('resetAllDataBtn').addEventListener('click', () => {
      this.showResetDataDialog();
    });
  }

  /**
   * 初始化自动备份设置
   */
  async initAutoBackupSettings() {
    const enableAutoBackup = document.getElementById('enableAutoBackup');
    const autoBackupSettings = document.getElementById('autoBackupSettings');
    const backupFrequency = document.getElementById('backupFrequency');
    const enableLocalSnapshot = document.getElementById('enableLocalSnapshot');
    const enableDirectoryBackup = document.getElementById('enableDirectoryBackup');
    const directoryBackupSection = document.getElementById('directoryBackupSection');
    const selectBackupDirectoryBtn = document.getElementById('selectBackupDirectoryBtn');
    const backupDirectoryStatus = document.getElementById('backupDirectoryStatus');
    const directoryPermissionStatus = document.getElementById('directoryPermissionStatus');
    const requestPermissionBtn = document.getElementById('requestPermissionBtn');
    const backupNowBtn = document.getElementById('backupNowBtn');
    const lastBackupTime = document.getElementById('lastBackupTime');
    const nextBackupTime = document.getElementById('nextBackupTime');

    // 加载当前设置
    const settings = await autoBackupManager.getSettings();
    enableAutoBackup.checked = settings.enabled;
    backupFrequency.value = settings.frequency;
    enableLocalSnapshot.checked = settings.localSnapshot;
    enableDirectoryBackup.checked = settings.directoryBackup;

    // 显示/隐藏设置区域
    autoBackupSettings.style.display = settings.enabled ? 'block' : 'none';
    directoryBackupSection.style.display = settings.directoryBackup ? 'block' : 'none';

    // 更新时间显示
    this.updateBackupTimeDisplay(settings);

    // 更新目录和权限状态
    await this.updateDirectoryStatus();

    // 启用/禁用自动备份
    enableAutoBackup.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      autoBackupSettings.style.display = enabled ? 'block' : 'none';

      if (enabled) {
        await autoBackupManager.setupAlarm(backupFrequency.value);
        this.updateBackupTimeDisplay(await autoBackupManager.getSettings());
      } else {
        await autoBackupManager.clearAlarm();
        nextBackupTime.textContent = '-';
      }

      await autoBackupManager.saveSettings({ enabled });
      this.showToast(enabled ? '已启用自动备份' : '已禁用自动备份', 'success');

      // 更新欢迎引导状态
      await this.refreshWelcomeStatus();
    });

    // 备份频率
    backupFrequency.addEventListener('change', async (e) => {
      const frequency = e.target.value;
      await autoBackupManager.saveSettings({ frequency });

      if (enableAutoBackup.checked) {
        await autoBackupManager.setupAlarm(frequency);
        this.updateBackupTimeDisplay(await autoBackupManager.getSettings());
      }
    });

    // 本地快照开关
    enableLocalSnapshot.addEventListener('change', async (e) => {
      await autoBackupManager.saveSettings({ localSnapshot: e.target.checked });
    });

    // 目录备份开关
    enableDirectoryBackup.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      directoryBackupSection.style.display = enabled ? 'block' : 'none';
      await autoBackupManager.saveSettings({ directoryBackup: enabled });

      if (enabled) {
        await this.updateDirectoryStatus();
      } else {
        backupDirectoryStatus.textContent = '未选择目录';
        directoryPermissionStatus.style.display = 'none';
      }
    });

    // 选择备份目录
    selectBackupDirectoryBtn.addEventListener('click', async () => {
      const result = await autoBackupManager.selectDirectory();

      if (result.success) {
        backupDirectoryStatus.textContent = `已选择: ${result.name}`;
        await this.updateDirectoryStatus();
        this.showToast('目录选择成功', 'success');
      } else {
        this.showToast(result.error || '选择失败', 'error');
      }
    });

    // 请求权限按钮
    requestPermissionBtn.addEventListener('click', async () => {
      const info = await autoBackupManager.getDirectoryInfo();

      // 如果权限被拒绝或没有句柄，重新选择目录
      if (info.permission === 'denied' || !info.hasHandle) {
        const result = await autoBackupManager.selectDirectory();
        if (result.success) {
          document.getElementById('backupDirectoryStatus').textContent = `已选择: ${result.name}`;
          await this.updateDirectoryStatus();
          this.showToast('目录选择成功', 'success');
        } else {
          this.showToast(result.error || '选择失败', 'error');
        }
      } else {
        // 请求权限
        const result = await autoBackupManager.requestPermission();
        if (result.success) {
          await this.updateDirectoryStatus();
          this.showToast('授权成功', 'success');
        } else {
          this.showToast(result.error || '授权失败', 'error');
        }
      }
    });

    // 立即备份
    backupNowBtn.addEventListener('click', async () => {
      if (this.secrets.length === 0) {
        this.showToast('没有可备份的密钥', 'error');
        return;
      }

      // 获取加密设置
      const encryptionSettings = await backupManager.getEncryptionSettings();
      let password = null;

      if (encryptionSettings.enabled) {
        if (encryptionSettings.useMasterPassword) {
          password = await this.getSessionKey();
          if (!password) {
            this.showToast('请先验证主密码', 'error');
            return;
          }
        } else if (encryptionSettings.encryptedPassword) {
          const sessionKey = await this.getSessionKey();
          if (!sessionKey) {
            this.showToast('请先验证主密码', 'error');
            return;
          }
          password = await CryptoUtils.decrypt(encryptionSettings.encryptedPassword, sessionKey);
        }
      }

      // 执行备份
      const results = await autoBackupManager.performBackup(this.secrets, { password });

      // 更新显示
      this.updateBackupTimeDisplay(await autoBackupManager.getSettings());

      // 显示结果
      const messages = [];
      if (results.snapshot) messages.push('本地快照已保存');
      if (results.directory?.success) messages.push(`文件已保存: ${results.directory.filename}`);

      if (messages.length > 0) {
        this.showToast(messages.join('，'), 'success');
      } else if (results.directory && !results.directory.success) {
        // 如果需要授权，更新状态
        if (results.directory.needAuth) {
          await this.updateDirectoryStatus();
        }
        this.showToast(results.directory.error || '备份失败', 'error');
      }
    });
  }

  /**
   * 更新目录状态显示
   */
  async updateDirectoryStatus() {
    const backupDirectoryStatus = document.getElementById('backupDirectoryStatus');
    const directoryPermissionStatus = document.getElementById('directoryPermissionStatus');
    const requestPermissionBtn = document.getElementById('requestPermissionBtn');

    const info = await autoBackupManager.getDirectoryInfo();

    if (!info.hasHandle) {
      backupDirectoryStatus.textContent = '未选择目录';
      directoryPermissionStatus.style.display = 'none';
      return;
    }

    backupDirectoryStatus.textContent = `已选择: ${info.name}`;

    // 显示权限状态
    directoryPermissionStatus.style.display = 'flex';
    directoryPermissionStatus.className = `permission-status ${info.permission}`;

    const permissionText = directoryPermissionStatus.querySelector('.permission-text');

    switch (info.permission) {
      case 'granted':
        permissionText.textContent = '已授权，可自动写入';
        requestPermissionBtn.style.display = 'none';
        break;
      case 'prompt':
        permissionText.textContent = '需要授权才能写入';
        requestPermissionBtn.style.display = 'block';
        requestPermissionBtn.textContent = '授权';
        break;
      case 'denied':
        permissionText.textContent = '权限被拒绝，请重新选择目录';
        requestPermissionBtn.style.display = 'block';
        requestPermissionBtn.textContent = '重新选择';
        break;
    }
  }

  /**
   * 更新备份时间显示
   */
  updateBackupTimeDisplay(settings) {
    const lastBackupTime = document.getElementById('lastBackupTime');
    const nextBackupTime = document.getElementById('nextBackupTime');

    // 上次备份时间
    if (settings.lastBackupTime) {
      const lastDate = new Date(settings.lastBackupTime);
      const now = new Date();
      const diffMs = now - lastDate;
      const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
      const diffHours = Math.floor(diffMs / (60 * 60 * 1000));

      if (diffDays > 0) {
        lastBackupTime.textContent = `${diffDays} 天前`;
      } else if (diffHours > 0) {
        lastBackupTime.textContent = `${diffHours} 小时前`;
      } else {
        lastBackupTime.textContent = '刚刚';
      }

      lastBackupTime.title = lastDate.toLocaleString('zh-CN');
    } else {
      lastBackupTime.textContent = '从未备份';
      lastBackupTime.title = '';
    }

    // 下次备份时间（基于间隔计算）
    if (settings.enabled && settings.lastBackupTime) {
      const interval = autoBackupManager.getBackupInterval(settings.frequency);
      const lastDate = new Date(settings.lastBackupTime);
      const nextDate = new Date(lastDate.getTime() + interval);
      const now = new Date();

      if (nextDate <= now) {
        nextBackupTime.textContent = '待执行';
        nextBackupTime.style.color = '#d97706';
      } else {
        const diffMs = nextDate - now;
        const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
        const diffHours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

        if (diffDays > 0) {
          nextBackupTime.textContent = `${diffDays} 天后`;
        } else if (diffHours > 0) {
          nextBackupTime.textContent = `${diffHours} 小时后`;
        } else {
          nextBackupTime.textContent = '即将';
        }
        nextBackupTime.style.color = '';
      }

      nextBackupTime.title = nextDate.toLocaleString('zh-CN');
    } else if (settings.enabled) {
      nextBackupTime.textContent = '待执行';
      nextBackupTime.style.color = '#d97706';
      nextBackupTime.title = '';
    } else {
      nextBackupTime.textContent = '-';
      nextBackupTime.style.color = '';
      nextBackupTime.title = '';
    }
  }

  /**
   * 显示页面
   */
  showPage(pageId) {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === pageId);
    });

    document.querySelectorAll('.page').forEach(page => {
      page.classList.toggle('active', page.id === pageId + 'Page');
    });
  }

  /**
   * 渲染密钥表格
   */
  async renderSecretsTable(filter = '') {
    const tbody = document.getElementById('secretsTableBody');
    const emptyState = document.getElementById('emptyState');
    const noResult = document.getElementById('noResultState');

    let filteredSecrets = this.secrets;
    if (filter) {
      const lowerFilter = filter.toLowerCase();
      filteredSecrets = this.secrets.filter(s =>
        (s.name && s.name.toLowerCase().includes(lowerFilter)) ||
        s.site.toLowerCase().includes(lowerFilter)
      );
    }

    document.getElementById('totalCount').textContent = this.secrets.length;

    tbody.innerHTML = '';

    if (this.secrets.length === 0) {
      emptyState.classList.remove('hidden');
      noResult.classList.add('hidden');
      return;
    }

    if (filteredSecrets.length === 0) {
      emptyState.classList.add('hidden');
      noResult.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    noResult.classList.add('hidden');

    for (const secret of filteredSecrets) {
      const row = await this.createSecretRow(secret);
      tbody.appendChild(row);
    }
  }

  /**
   * 创建密钥行
   */
  async createSecretRow(secret) {
    const tr = document.createElement('tr');
    tr.dataset.id = secret.id;

    const result = await TOTP.generate(secret.secret, secret.digits);
    this.codeData.set(secret.id, result.code);

    const formattedCode = this.formatCode(result.code);
    const initial = (secret.name || secret.site || '?')[0].toUpperCase();
    const createdAt = secret.createdAt ? new Date(secret.createdAt).toLocaleDateString('zh-CN') : '-';

    tr.innerHTML = `
      <td>
        <div class="site-cell">
          <div class="site-icon">${initial}</div>
          <div class="site-info">
            <div class="site-name">${secret.site}</div>
          </div>
        </div>
      </td>
      <td>${secret.name || '-'}</td>
      <td>
        <span class="otp-cell">
          <span class="otp-value">${formattedCode}</span>
          <span class="timer">${result.remainingSeconds}s</span>
        </span>
      </td>
      <td><span class="digits-badge">${secret.digits || 6} 位</span></td>
      <td>${createdAt}</td>
      <td>
        <div class="action-btns">
          <button class="action-btn copy" title="复制验证码">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button class="action-btn edit" title="编辑">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="action-btn delete" title="删除">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </td>
    `;

    tr.querySelector('.action-btn.copy').addEventListener('click', async () => {
      const code = this.codeData.get(secret.id);
      if (code) {
        await this.copyToClipboard(code);
        this.showToast('验证码已复制', 'success');
      }
    });

    tr.querySelector('.action-btn.edit').addEventListener('click', () => {
      this.showSecretModal(secret);
    });

    tr.querySelector('.action-btn.delete').addEventListener('click', async () => {
      if (confirm(`确定要删除 "${secret.name || secret.site}" 吗？`)) {
        this.secrets = this.secrets.filter(s => s.id !== secret.id);
        await this.saveSecrets();
        this.renderSecretsTable();
        this.showToast('密钥已删除');
      }
    });

    return tr;
  }

  /**
   * 格式化验证码
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
   * 启动计时器
   */
  startTimers() {
    setInterval(async () => {
      const rows = document.querySelectorAll('#secretsTableBody tr');
      for (const row of rows) {
        const id = row.dataset.id;
        const secret = this.secrets.find(s => s.id === id);
        if (secret) {
          const result = await TOTP.generate(secret.secret, secret.digits);
          this.codeData.set(id, result.code);

          const otpValue = row.querySelector('.otp-value');
          const timer = row.querySelector('.timer');

          if (otpValue) {
            otpValue.textContent = this.formatCode(result.code);
          }
          if (timer) {
            timer.textContent = `${result.remainingSeconds}s`;
          }
        }
      }
    }, 1000);
  }

  /**
   * 显示密钥模态框
   */
  showSecretModal(secret = null) {
    const modal = document.getElementById('secretModal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('secretForm');

    form.reset();
    document.getElementById('secretError').textContent = '';

    if (secret) {
      title.textContent = '编辑密钥';
      document.getElementById('secretId').value = secret.id;
      document.getElementById('secretInput').value = secret.secret;
      document.getElementById('siteInput').value = secret.site;
      document.getElementById('nameInput').value = secret.name || '';
      document.getElementById('digitsSelect').value = secret.digits || 6;
    } else {
      title.textContent = '添加密钥';
      document.getElementById('secretId').value = '';
    }

    modal.classList.remove('hidden');
  }

  /**
   * 隐藏密钥模态框
   */
  hideSecretModal() {
    document.getElementById('secretModal').classList.add('hidden');
  }

  /**
   * 保存密钥
   */
  async saveSecret() {
    // 防止重复提交
    const submitBtn = document.querySelector('#secretForm button[type="submit"]');
    if (submitBtn.disabled) {
      return;
    }

    const id = document.getElementById('secretId').value;
    const secret = document.getElementById('secretInput').value.trim().toUpperCase();
    const site = document.getElementById('siteInput').value.trim().toLowerCase();
    const name = document.getElementById('nameInput').value.trim();
    const digits = parseInt(document.getElementById('digitsSelect').value);

    if (!TOTP.isValidSecret(secret)) {
      document.getElementById('secretError').textContent = '密钥格式无效（至少需要 16 个字符）';
      return;
    }

    if (!site) {
      this.showToast('请输入目标站点', 'error');
      return;
    }

    // 显示加载状态
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = '保存中...';

    try {
      if (id) {
        // 编辑现有密钥
        const index = this.secrets.findIndex(s => s.id === id);
        if (index !== -1) {
          this.secrets[index] = {
            ...this.secrets[index],
            secret,
            site,
            name,
            digits,
            updatedAt: new Date().toISOString()
          };
        }
      } else {
        // 添加新密钥（允许同站点多个密钥）
        this.secrets.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          secret,
          site,
          name,
          digits,
          createdAt: new Date().toISOString()
        });
      }

      await this.saveSecrets();
      this.hideSecretModal();
      this.renderSecretsTable();
      this.showToast(id ? '密钥已更新' : '密钥已添加', 'success');

      // 更新欢迎引导状态
      this.refreshWelcomeStatus().catch(() => {});
    } finally {
      // 恢复按钮状态
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }

  /**
   * 导出密钥
   */
  async exportSecrets() {
    if (this.secrets.length === 0) {
      this.showToast('没有可导出的密钥', 'error');
      return;
    }

    // 获取加密设置
    const encryptionSettings = await backupManager.getEncryptionSettings();
    let password = null;

    if (encryptionSettings.enabled) {
      // 需要加密
      if (encryptionSettings.useMasterPassword) {
        // 使用主密码
        const sessionKey = await this.getSessionKey();
        if (!sessionKey) {
          this.showToast('请先验证主密码', 'error');
          return;
        }
        password = sessionKey;
      } else {
        // 使用自定义备份密码
        if (!encryptionSettings.encryptedPassword) {
          this.showToast('请先设置备份密码', 'error');
          return;
        }
        // 解密存储的备份密码
        const sessionKey = await this.getSessionKey();
        if (!sessionKey) {
          this.showToast('请先验证主密码', 'error');
          return;
        }
        password = await CryptoUtils.decrypt(encryptionSettings.encryptedPassword, sessionKey);
      }
    }

    // 创建备份
    const backupData = await backupManager.createBackup(this.secrets, { password });

    const json = JSON.stringify(backupData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().slice(0, 10);
    const suffix = encryptionSettings.enabled ? '-encrypted' : '';
    const filename = `openpass-backup-${timestamp}${suffix}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showToast(`已导出 ${this.secrets.length} 个密钥${encryptionSettings.enabled ? '（已加密）' : ''}`, 'success');
  }

  /**
   * 获取会话密钥
   */
  async getSessionKey() {
    const result = await chrome.storage.session.get(['sessionKey']);
    return result.sessionKey || null;
  }

  /**
   * 验证备份数据
   */
  validateBackupData(data) {
    const result = backupManager.validateBackup(data);
    if (!result.valid) {
      console.error('备份验证失败:', result.error);
      return false;
    }
    return true;
  }

  /**
   * 导入密钥
   */
  async importSecrets(importSecrets, duplicateAction) {
    const total = importSecrets.length;
    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let processedCount = 0;

    // 显示进度提示
    const progressToast = this.showProgressToast('正在导入...', 0, total);

    for (const secret of importSecrets) {
      processedCount++;

      // 更新进度（每 10 个更新一次，避免频繁更新）
      if (processedCount % 10 === 0 || processedCount === total) {
        this.updateProgressToast(progressToast, processedCount, total);
      }

      // 使用 site + secret 组合判断唯一性
      const existingIndex = this.secrets.findIndex(
        s => s.site.toLowerCase() === secret.site.toLowerCase() &&
             s.secret.toUpperCase() === secret.secret.toUpperCase()
      );

      if (existingIndex !== -1) {
        if (duplicateAction === 'skip') {
          skippedCount++;
        } else if (duplicateAction === 'overwrite') {
          this.secrets[existingIndex] = {
            ...this.secrets[existingIndex],
            secret: secret.secret,
            digits: secret.digits || 6,
            name: secret.name || this.secrets[existingIndex].name,
            updatedAt: new Date().toISOString()
          };
          updatedCount++;
        } else if (duplicateAction === 'both') {
          const newSecret = {
            ...secret,
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            site: secret.site + '-' + Date.now().toString(36),
            importedAt: new Date().toISOString()
          };
          this.secrets.push(newSecret);
          addedCount++;
        }
      } else {
        const newSecret = {
          ...secret,
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          importedAt: new Date().toISOString()
        };
        this.secrets.push(newSecret);
        addedCount++;
      }
    }

    // 移除进度提示
    this.hideProgressToast(progressToast);

    await this.saveSecrets();
    this.renderSecretsTable();

    const messages = [];
    if (addedCount > 0) messages.push(`新增 ${addedCount} 个`);
    if (updatedCount > 0) messages.push(`更新 ${updatedCount} 个`);
    if (skippedCount > 0) messages.push(`跳过 ${skippedCount} 个`);

    this.showToast(`导入完成：${messages.join('，')}`, 'success');
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
   * 显示 Toast
   */
  showToast(message, type = 'default') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  /**
   * 显示进度提示
   */
  showProgressToast(message, current, total) {
    // 移除已有的进度提示
    const existing = document.getElementById('progressToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'progressToast';
    toast.className = 'progress-toast';
    toast.innerHTML = `
      <div class="progress-content">
        <div class="progress-spinner"></div>
        <div class="progress-text">${message}</div>
        <div class="progress-count">${current}/${total}</div>
      </div>
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width: ${total > 0 ? (current / total * 100) : 0}%"></div>
      </div>
    `;

    document.body.appendChild(toast);
    return toast;
  }

  /**
   * 更新进度提示
   */
  updateProgressToast(toast, current, total) {
    if (!toast) return;

    const countEl = toast.querySelector('.progress-count');
    const barEl = toast.querySelector('.progress-bar-fill');

    if (countEl) {
      countEl.textContent = `${current}/${total}`;
    }
    if (barEl) {
      barEl.style.width = `${total > 0 ? (current / total * 100) : 0}%`;
    }
  }

  /**
   * 隐藏进度提示
   */
  hideProgressToast(toast) {
    if (toast) {
      toast.remove();
    } else {
      const existing = document.getElementById('progressToast');
      if (existing) existing.remove();
    }
  }

  /**
   * 显示修改主密码模态框
   */
  showPasswordModal() {
    document.getElementById('passwordForm').reset();
    document.getElementById('strengthFill').className = 'strength-fill';
    document.getElementById('strengthText').textContent = '';
    document.getElementById('passwordError').textContent = '';
    document.getElementById('passwordModal').classList.remove('hidden');
    document.getElementById('currentPassword').focus();
  }

  /**
   * 隐藏修改主密码模态框
   */
  hidePasswordModal() {
    document.getElementById('passwordModal').classList.add('hidden');
  }

  /**
   * 检查密码强度
   */
  checkPasswordStrength(password) {
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;

    const levels = ['', 'weak', 'fair', 'good', 'good', 'strong'];
    const texts = ['', '弱', '一般', '良好', '良好', '强'];

    document.getElementById('strengthFill').className = 'strength-fill ' + levels[score];
    document.getElementById('strengthText').textContent = texts[score] ? `密码强度：${texts[score]}` : '';
  }

  /**
   * 修改主密码
   */
  async changePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;
    const errorEl = document.getElementById('passwordError');

    // 验证
    if (!currentPassword) {
      errorEl.textContent = '请输入当前密码';
      return;
    }

    if (newPassword.length < 6) {
      errorEl.textContent = '新密码至少需要 6 个字符';
      return;
    }

    if (newPassword !== confirmPassword) {
      errorEl.textContent = '两次输入的密码不一致';
      return;
    }

    try {
      // 验证当前密码
      const result = await chrome.storage.local.get(['masterPasswordHash', 'masterPasswordSalt']);
      const isValid = await CryptoUtils.verifyMasterPassword(
        currentPassword,
        result.masterPasswordHash,
        result.masterPasswordSalt
      );

      if (!isValid) {
        errorEl.textContent = '当前密码错误';
        return;
      }

      // 创建新密码哈希
      const { hash, salt } = await CryptoUtils.createMasterPasswordHash(newPassword);

      // 保存新密码
      await chrome.storage.local.set({
        masterPasswordHash: hash,
        masterPasswordSalt: salt
      });

      // 清除会话，要求重新认证
      await sessionManager.clearSession();

      this.hidePasswordModal();
      this.showToast('主密码已修改，请重新登录', 'success');

      // 跳转到认证页面
      setTimeout(() => {
        window.location.href = 'auth.html?redirect=manager.html';
      }, 1000);
    } catch (error) {
      console.error('修改密码失败:', error);
      errorEl.textContent = '修改失败，请重试';
    }
  }

  /**
   * 显示清空密钥确认对话框
   */
  showClearSecretsDialog() {
    // 创建对话框
    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `
      <div class="confirm-dialog-content">
        <h3 class="confirm-dialog-title">⚠️ 清空所有密钥</h3>
        <p class="confirm-dialog-message">
          此操作将删除所有已保存的密钥和备份快照。<br>
          <strong>此操作不可撤销！</strong>
        </p>
        <div class="confirm-dialog-input">
          <label>请输入 "DELETE" 确认删除</label>
          <input type="text" id="confirmDeleteInput" placeholder="输入 DELETE">
        </div>
        <div class="confirm-dialog-actions">
          <button class="btn-secondary" id="cancelClearBtn">取消</button>
          <button class="btn-danger" id="confirmClearBtn" disabled>确认清空</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const input = document.getElementById('confirmDeleteInput');
    const confirmBtn = document.getElementById('confirmClearBtn');
    const cancelBtn = document.getElementById('cancelClearBtn');

    // 输入验证
    input.addEventListener('input', () => {
      confirmBtn.disabled = input.value !== 'DELETE';
    });

    // 取消
    cancelBtn.addEventListener('click', () => {
      dialog.remove();
    });

    // 点击背景关闭
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        dialog.remove();
      }
    });

    // 确认清除
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = '清空中...';

      try {
        await this.clearAllSecrets();
        dialog.remove();
        this.showToast('密钥已清空', 'success');

        // 刷新列表
        this.secrets = [];
        this.renderSecretsTable();
        document.getElementById('totalCount').textContent = '0';
      } catch (error) {
        console.error('清空密钥失败:', error);
        this.showToast('清空失败', 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认清空';
      }
    });
  }

  /**
   * 显示重置数据确认对话框
   */
  showResetDataDialog() {
    // 创建对话框
    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `
      <div class="confirm-dialog-content">
        <h3 class="confirm-dialog-title">⚠️ 重置所有数据</h3>
        <p class="confirm-dialog-message">
          此操作将删除所有密钥、设置、主密码，恢复到初始状态。<br>
          <strong>此操作不可撤销！</strong>
        </p>
        <div class="confirm-dialog-input">
          <label>请输入 "RESET" 确认重置</label>
          <input type="text" id="confirmResetInput" placeholder="输入 RESET">
        </div>
        <div class="confirm-dialog-actions">
          <button class="btn-secondary" id="cancelResetBtn">取消</button>
          <button class="btn-danger" id="confirmResetBtn" disabled>确认重置</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const input = document.getElementById('confirmResetInput');
    const confirmBtn = document.getElementById('confirmResetBtn');
    const cancelBtn = document.getElementById('cancelResetBtn');

    // 输入验证
    input.addEventListener('input', () => {
      confirmBtn.disabled = input.value !== 'RESET';
    });

    // 取消
    cancelBtn.addEventListener('click', () => {
      dialog.remove();
    });

    // 点击背景关闭
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        dialog.remove();
      }
    });

    // 确认重置
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = '重置中...';

      try {
        await this.resetAllData();
        dialog.remove();
        this.showToast('数据已重置', 'success');

        // 刷新页面，重新开始引导
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } catch (error) {
        console.error('重置数据失败:', error);
        this.showToast('重置失败', 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认重置';
      }
    });
  }

  /**
   * 清空所有密钥
   */
  async clearAllSecrets() {
    // 只清除密钥相关数据，保留设置
    await chrome.storage.local.remove([
      'secrets',
      'sitesList',
      'encryptedSecrets',
      'backupSnapshots',
      'lastBackupTime'
    ]);

    // 清除 IndexedDB 中的备份快照
    return new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('OpenPassBackupDB');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }

  /**
   * 重置所有数据
   */
  async resetAllData() {
    // 清除 chrome.storage.local
    await chrome.storage.local.clear();

    // 清除 chrome.storage.session
    await chrome.storage.session.clear();

    // 清除 IndexedDB（目录句柄）
    return new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('OpenPassBackupDB');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new ManagerApp();
});