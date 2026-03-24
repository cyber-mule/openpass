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
    // 检查是否已设置主密码
    const setupComplete = await this.checkSetup();
    if (!setupComplete) {
      window.location.href = 'setup.html';
      return;
    }

    // 检查会话
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
      }, resolve);
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
      let importData = this.pendingImportData;

      // 如果是加密备份，先解密
      if (this.isEncryptedBackup) {
        const password = document.getElementById('decryptPassword').value;
        if (!password) {
          document.getElementById('decryptError').textContent = '请输入备份密码';
          document.getElementById('decryptError').style.display = 'block';
          return;
        }

        const decryptedBackup = await backupManager.decryptBackup(this.pendingBackupData, password);
        if (!decryptedBackup) {
          document.getElementById('decryptError').textContent = '密码错误，解密失败';
          document.getElementById('decryptError').style.display = 'block';
          return;
        }

        // 检查版本兼容性并迁移
        const compatibility = backupManager.checkCompatibility(decryptedBackup.appVersion || '0.0.0');
        let data = decryptedBackup;
        if (compatibility.level === 'warning') {
          data = backupManager.migrateData(decryptedBackup);
        }

        importData = data.secrets;
      }

      if (!importData) return;

      const action = document.querySelector('input[name="duplicateAction"]:checked').value;
      await this.importSecrets(importData, action);
      this.pendingImportData = null;
      this.pendingBackupData = null;
      this.isEncryptedBackup = false;
      document.getElementById('importModal').classList.add('hidden');
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
    lastBackupTime.textContent = autoBackupManager.formatTime(settings.lastBackupTime);
    nextBackupTime.textContent = autoBackupManager.formatTime(settings.nextBackupTime);

    // 检查目录句柄状态
    if (settings.directoryBackup && settings.directoryHandle) {
      backupDirectoryStatus.textContent = `已选择: ${settings.directoryHandle}`;
    }

    // 启用/禁用自动备份
    enableAutoBackup.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      autoBackupSettings.style.display = enabled ? 'block' : 'none';

      if (enabled) {
        await autoBackupManager.setupAlarm(backupFrequency.value);
        const newSettings = await autoBackupManager.getSettings();
        nextBackupTime.textContent = autoBackupManager.formatTime(newSettings.nextBackupTime);
      } else {
        await autoBackupManager.clearAlarm();
        nextBackupTime.textContent = '-';
      }

      await autoBackupManager.saveSettings({ enabled });
      this.showToast(enabled ? '已启用自动备份' : '已禁用自动备份', 'success');
    });

    // 备份频率
    backupFrequency.addEventListener('change', async (e) => {
      const frequency = e.target.value;
      await autoBackupManager.saveSettings({ frequency });

      if (enableAutoBackup.checked) {
        await autoBackupManager.setupAlarm(frequency);
        const newSettings = await autoBackupManager.getSettings();
        nextBackupTime.textContent = autoBackupManager.formatTime(newSettings.nextBackupTime);
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

      if (!enabled) {
        backupDirectoryStatus.textContent = '未选择目录';
      }
    });

    // 选择备份目录
    selectBackupDirectoryBtn.addEventListener('click', async () => {
      const result = await autoBackupManager.selectDirectory();

      if (result.success) {
        backupDirectoryStatus.textContent = `已选择: ${result.name}`;
        this.showToast('目录选择成功', 'success');
      } else {
        this.showToast(result.error || '选择失败', 'error');
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
      lastBackupTime.textContent = autoBackupManager.formatTime(results.timestamp);

      // 显示结果
      const messages = [];
      if (results.snapshot) messages.push('本地快照已保存');
      if (results.directory?.success) messages.push(`文件已保存: ${results.directory.filename}`);

      if (messages.length > 0) {
        this.showToast(messages.join('，'), 'success');
      } else if (results.directory && !results.directory.success) {
        this.showToast(results.directory.error || '备份失败', 'error');
      }
    });
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
    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const secret of importSecrets) {
      const existingIndex = this.secrets.findIndex(
        s => s.site.toLowerCase() === secret.site.toLowerCase()
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
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new ManagerApp();
});