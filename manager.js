/**
 * TOTPPass - Manager Page Logic
 * 支持主密码认证和加密存储
 */

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
    if (!sessionManager.isAuthenticated()) {
      window.location.href = 'auth.html?redirect=manager.html';
      return;
    }

    this.isAuthenticated = true;

    await this.loadSecrets();
    this.loadVersionSignature();
    this.bindEvents();
    this.renderSecretsTable();
    this.startTimers();
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
  getSessionKey() {
    return sessionManager.getSessionKey();
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
   * 加载密钥（解密）
   */
  async loadSecrets() {
    return new Promise(async (resolve) => {
      chrome.storage.local.get(['encryptedSecrets', 'secrets'], async (result) => {
        // 优先使用加密存储
        if (result.encryptedSecrets) {
          try {
            const sessionKey = this.getSessionKey();
            if (sessionKey) {
              const decrypted = await CryptoUtils.decrypt(result.encryptedSecrets, sessionKey);
              this.secrets = JSON.parse(decrypted);
            } else {
              this.secrets = [];
            }
          } catch (error) {
            console.error('解密失败:', error);
            this.secrets = [];
          }
        } else if (result.secrets) {
          // 兼容旧版本：迁移明文数据
          this.secrets = result.secrets;
          // 加密存储
          await this.saveSecrets();
          // 删除明文数据
          await chrome.storage.local.remove(['secrets']);
        } else {
          this.secrets = [];
        }
        resolve();
      });
    });
  }

  /**
   * 保存密钥（加密）
   */
  async saveSecrets() {
    const sessionKey = this.getSessionKey();
    if (!sessionKey) {
      throw new Error('会话已过期');
    }

    const json = JSON.stringify(this.secrets);
    const encrypted = await CryptoUtils.encrypt(json, sessionKey);

    // 同时保存明文站点列表（用于 badge 显示）
    const sitesList = this.secrets.map(s => ({ site: s.site }));

    return new Promise((resolve) => {
      chrome.storage.local.set({
        encryptedSecrets: encrypted,
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
        const data = JSON.parse(text);

        if (!this.validateBackupData(data)) {
          this.showToast('备份文件格式无效', 'error');
          return;
        }

        this.pendingImportData = data.secrets;
        document.getElementById('importCount').textContent = data.secrets.length;
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
      if (!this.pendingImportData) return;

      const action = document.querySelector('input[name="duplicateAction"]:checked').value;
      await this.importSecrets(this.pendingImportData, action);
      this.pendingImportData = null;
      document.getElementById('importModal').classList.add('hidden');
    });

    document.getElementById('cancelImportBtn').addEventListener('click', () => {
      this.pendingImportData = null;
      document.getElementById('importModal').classList.add('hidden');
    });

    document.querySelector('#importModal .modal-overlay').addEventListener('click', () => {
      this.pendingImportData = null;
      document.getElementById('importModal').classList.add('hidden');
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
      const index = this.secrets.findIndex(s => s.id === id);
      if (index !== -1) {
        const conflict = this.secrets.some(s => s.site === site && s.id !== id);
        if (conflict) {
          this.showToast('该站点已存在其他密钥', 'error');
          return;
        }

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
      const exists = this.secrets.some(s => s.site === site);
      if (exists) {
        this.showToast('该站点已存在密钥', 'error');
        return;
      }

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
   * 导出密钥（明文，带版本号）
   */
  exportSecrets() {
    if (this.secrets.length === 0) {
      this.showToast('没有可导出的密钥', 'error');
      return;
    }

    const backupData = {
      version: '2.0',
      format: 'totppass-backup',
      exportTime: new Date().toISOString(),
      count: this.secrets.length,
      encrypted: false,
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
  }

  /**
   * 验证备份数据
   */
  validateBackupData(data) {
    if (!data || typeof data !== 'object') return false;

    // 检查版本和格式
    if (data.format === 'totppass-backup') {
      // 新格式
      if (!Array.isArray(data.secrets)) return false;
    } else if (data.version === '1.0') {
      // 旧格式兼容
      if (!Array.isArray(data.secrets)) return false;
    } else if (Array.isArray(data.secrets)) {
      // 最简格式
    } else {
      return false;
    }

    for (const secret of data.secrets) {
      if (!secret.secret || !secret.site) return false;
      if (typeof secret.secret !== 'string' || typeof secret.site !== 'string') return false;
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
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new ManagerApp();
});