<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import TOTP from '@/utils/totp';

interface Secret {
  id: string;
  secret: string;
  site: string;
  name?: string;
  digits?: number;
  createdAt?: string;
}

// 状态
const secrets = ref<Secret[]>([]);
const searchQuery = ref('');
const currentPage = ref('home');
const currentUrl = ref('');
const pendingSecret = ref<{ secret: string; site: string; name: string } | null>(null);
const editingSecret = ref<Secret | null>(null);
const showMenu = ref(false);
const showRestoreModal = ref(false);
const showAboutModal = ref(false);
const pendingImportData = ref<any>(null);
const isEncryptedImport = ref(false);
const importPassword = ref('');
const importPasswordError = ref('');

// 验证码数据
const codeData = ref<Map<string, { code: string; remainingSeconds: number }>>(new Map());
const timers = ref<Map<string, number>>(new Map());
const previewTimer = ref<number | null>(null);
const previewCode = ref('');
const previewRemaining = ref(0);

// 表单
const createForm = ref({
  secret: '',
  site: '',
  name: '',
  digits: 6
});
const createError = ref('');

// 版本
const version = ref('');
const isSetupComplete = ref(false);

// Toast
const toastMessage = ref('');
const toastVisible = ref(false);
const toastSuccess = ref(false);

onMounted(async () => {
  const manifest = chrome.runtime.getManifest();
  version.value = manifest.version;

  // 检查设置是否完成
  const result = await chrome.storage.local.get(['isSetupComplete', 'secrets', 'pendingSecret']);
  isSetupComplete.value = result.isSetupComplete === true;

  if (!isSetupComplete.value) {
    return;
  }

  secrets.value = result.secrets || [];

  // 获取当前标签页
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      currentUrl.value = tab.url;
    }
  } catch {}

  // 检查待添加密钥
  if (result.pendingSecret) {
    pendingSecret.value = result.pendingSecret;
    await chrome.storage.local.remove(['pendingSecret']);
    // 预填充创建表单
    createForm.value.secret = pendingSecret.value.secret;
    createForm.value.site = pendingSecret.value.site;
    createForm.value.name = pendingSecret.value.name;
    currentPage.value = 'create';
  }

  // 启动验证码更新
  startCodeUpdater();
});

onUnmounted(() => {
  clearAllTimers();
});

// Toast
function showToast(message: string, success = false) {
  toastMessage.value = message;
  toastSuccess.value = success;
  toastVisible.value = true;
  setTimeout(() => {
    toastVisible.value = false;
  }, 2000);
}

// 计时器
function startCodeUpdater() {
  secrets.value.forEach(secret => {
    startCardTimer(secret);
  });
}

function startCardTimer(secret: Secret) {
  updateSecretCode(secret);
  const timerId = setInterval(() => updateSecretCode(secret), 1000);
  timers.value.set(secret.id, timerId);
}

async function updateSecretCode(secret: Secret) {
  try {
    const result = await TOTP.generateCode(secret.secret, secret.digits || 6);
    codeData.value.set(secret.id, result);
  } catch {}
}

function clearAllTimers() {
  timers.value.forEach(timer => clearInterval(timer));
  timers.value.clear();
  if (previewTimer.value) {
    clearInterval(previewTimer.value);
    previewTimer.value = null;
  }
}

// URL 解析
function parseUrl(url: string) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const parts = hostname.split('.');
    let mainDomain = hostname;
    if (parts.length >= 2) {
      mainDomain = parts.slice(-2).join('.');
    }
    return {
      fullUrl: urlObj.href,
      origin: urlObj.origin,
      fullDomain: hostname,
      mainDomain
    };
  } catch {
    return null;
  }
}

// 匹配当前网站
const currentSiteMatches = computed(() => {
  if (!currentUrl.value) return [];
  const urlInfo = parseUrl(currentUrl.value);
  if (!urlInfo) return [];

  return secrets.value.filter(secret => {
    const site = secret.site.toLowerCase();
    const fullDomain = urlInfo.fullDomain.toLowerCase();
    const mainDomain = urlInfo.mainDomain.toLowerCase();
    return fullDomain.includes(site) || site.includes(fullDomain) ||
           mainDomain.includes(site) || site.includes(mainDomain);
  });
});

// 搜索结果
const searchResults = computed(() => {
  if (!searchQuery.value) return [];
  const query = searchQuery.value.toLowerCase();
  return secrets.value.filter(s =>
    (s.name?.toLowerCase().includes(query)) ||
    s.site.toLowerCase().includes(query)
  );
});

// 格式化验证码
function formatCode(code: string): string {
  if (code.length === 6) {
    return code.slice(0, 3) + ' ' + code.slice(3);
  } else if (code.length === 8) {
    return code.slice(0, 4) + ' ' + code.slice(4);
  }
  return code;
}

// 复制
async function copyCode(secret: Secret) {
  const data = codeData.value.get(secret.id);
  if (data) {
    await TOTP.copyToClipboard(data.code);
    showToast('验证码已复制', true);
  }
}

// 保存密钥
async function saveSecrets() {
  const sitesList = secrets.value.map(s => ({ site: s.site }));
  await chrome.storage.local.set({
    secrets: secrets.value,
    sitesList
  });
}

// 创建密钥
async function createSecret() {
  const secret = createForm.value.secret.trim().toUpperCase().replace(/\s/g, '');
  const site = createForm.value.site.trim().toLowerCase();
  const name = createForm.value.name.trim();
  const digits = createForm.value.digits;

  if (!TOTP.isValidSecret(secret)) {
    createError.value = '密钥格式无效（至少需要 16 个字符）';
    return;
  }

  if (!site) {
    createError.value = '请输入目标站点';
    return;
  }

  const newSecret: Secret = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    secret,
    digits,
    site,
    name,
    createdAt: new Date().toISOString()
  };

  secrets.value.push(newSecret);
  await saveSecrets();
  showToast('密钥已保存', true);

  // 重置表单
  createForm.value = { secret: '', site: '', name: '', digits: 6 };
  createError.value = '';
  currentPage.value = 'home';
  pendingSecret.value = null;

  // 启动计时器
  startCardTimer(newSecret);
}

// 更新预览
async function updatePreview() {
  const secret = createForm.value.secret.trim().toUpperCase().replace(/\s/g, '');
  if (!secret) {
    previewCode.value = '';
    if (previewTimer.value) {
      clearInterval(previewTimer.value);
      previewTimer.value = null;
    }
    return;
  }

  try {
    const result = await TOTP.generateCode(secret, createForm.value.digits);
    previewCode.value = formatCode(result.code);
    previewRemaining.value = result.remainingSeconds;

    if (previewTimer.value) clearInterval(previewTimer.value);
    previewTimer.value = setInterval(async () => {
      try {
        const r = await TOTP.generateCode(secret, createForm.value.digits);
        previewCode.value = formatCode(r.code);
        previewRemaining.value = r.remainingSeconds;
      } catch {}
    }, 1000);
  } catch {
    previewCode.value = '';
  }
}

watch(() => createForm.value.secret, updatePreview);
watch(() => createForm.value.digits, updatePreview);

// 密钥输入格式化
function formatSecretInput() {
  createForm.value.secret = createForm.value.secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (createForm.value.secret && !TOTP.isValidSecret(createForm.value.secret)) {
    createError.value = '密钥格式无效（至少需要 16 个字符）';
  } else {
    createError.value = '';
  }
}

// 编辑密钥
function showEditPage(secret: Secret) {
  editingSecret.value = { ...secret };
  currentPage.value = 'edit';
  clearAllTimers();
}

async function updateSecret() {
  if (!editingSecret.value) return;

  const secret = editingSecret.value.secret.toUpperCase().replace(/\s/g, '');
  if (!TOTP.isValidSecret(secret)) {
    showToast('密钥格式无效');
    return;
  }

  const index = secrets.value.findIndex(s => s.id === editingSecret.value!.id);
  if (index !== -1) {
    secrets.value[index] = {
      ...secrets.value[index],
      secret,
      site: editingSecret.value.site.toLowerCase(),
      name: editingSecret.value.name,
      updatedAt: new Date().toISOString()
    };
    await saveSecrets();
    showToast('密钥已更新', true);
    currentPage.value = 'home';
    editingSecret.value = null;
    startCardTimer(secrets.value[index]);
  }
}

async function deleteSecret() {
  if (!editingSecret.value) return;
  const name = editingSecret.value.name || editingSecret.value.site;
  if (confirm(`确定要删除 "${name}" 吗？`)) {
    const id = editingSecret.value.id;
    secrets.value = secrets.value.filter(s => s.id !== id);
    await saveSecrets();
    showToast('密钥已删除');
    currentPage.value = 'home';
    editingSecret.value = null;
  }
}

// 导出
async function exportSecrets() {
  showMenu.value = false;
  if (secrets.value.length === 0) {
    showToast('没有可导出的密钥');
    return;
  }

  const backupData = {
    format: 'openpass-backup',
    formatVersion: 1,
    appVersion: version.value,
    exportTime: new Date().toISOString(),
    count: secrets.value.length,
    secrets: secrets.value
  };

  const json = JSON.stringify(backupData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `openpass-backup-${timestamp}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  showToast(`已导出 ${secrets.value.length} 个密钥`, true);
}

// 导入
function triggerImport() {
  showMenu.value = false;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = handleFileSelect;
  input.click();
}

async function handleFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (data.format === 'openpass-backup') {
      if (data.encrypted && data.encryptedData) {
        pendingImportData.value = data;
        isEncryptedImport.value = true;
        showRestoreModal.value = true;
      } else if (Array.isArray(data.secrets)) {
        pendingImportData.value = data;
        isEncryptedImport.value = false;
        showRestoreModal.value = true;
      }
    } else if (Array.isArray(data)) {
      pendingImportData.value = { secrets: data, count: data.length };
      isEncryptedImport.value = false;
      showRestoreModal.value = true;
    } else if (Array.isArray(data.secrets)) {
      pendingImportData.value = data;
      isEncryptedImport.value = false;
      showRestoreModal.value = true;
    } else {
      showToast('无法识别的备份格式');
    }
  } catch {
    showToast('读取文件失败');
  }
}

async function mergeImport() {
  if (!pendingImportData.value?.secrets) return;

  let added = 0, skipped = 0;
  for (const secret of pendingImportData.value.secrets) {
    const exists = secrets.value.some(s =>
      s.site.toLowerCase() === secret.site?.toLowerCase()
    );
    if (!exists) {
      secrets.value.push({
        ...secret,
        id: secret.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
        importedAt: new Date().toISOString()
      });
      added++;
      startCardTimer(secrets.value[secrets.value.length - 1]);
    } else {
      skipped++;
    }
  }

  await saveSecrets();
  showRestoreModal.value = false;
  pendingImportData.value = null;
  showToast(skipped > 0 ? `已导入 ${added} 个，跳过 ${skipped} 个重复` : `已导入 ${added} 个密钥`, true);
}

async function overwriteImport() {
  if (!pendingImportData.value?.secrets) return;
  if (!confirm('覆盖将删除所有现有密钥，确定继续吗？')) return;

  clearAllTimers();
  secrets.value = pendingImportData.value.secrets.map(secret => ({
    ...secret,
    id: secret.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
    importedAt: new Date().toISOString()
  }));

  await saveSecrets();
  showRestoreModal.value = false;
  pendingImportData.value = null;
  showToast(`已导入 ${secrets.value.length} 个密钥`, true);
  startCodeUpdater();
}

// 打开管理页面
function openOptionsPage() {
  showMenu.value = false;
  chrome.runtime.openOptionsPage();
  window.close();
}

// 打开设置页面
function openSetupPage() {
  chrome.runtime.openOptionsPage();
  window.close();
}
</script>

<template>
  <div class="container">
    <!-- 未设置引导 -->
    <div v-if="!isSetupComplete" class="setup-prompt">
      <div class="setup-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h2>欢迎使用 OpenPass</h2>
      <p>请先设置主密码以保护你的密钥</p>
      <button class="btn-primary" @click="openSetupPage">设置主密码</button>
    </div>

    <!-- 正常界面 -->
    <template v-else>
      <!-- 头部 -->
      <header class="header">
        <h1 class="title">OpenPass</h1>
        <div class="header-actions">
          <button class="icon-btn" title="添加密钥" @click="currentPage = 'create'">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </button>
          <div class="dropdown" @click.stop>
            <button class="icon-btn" title="更多操作" @click="showMenu = !showMenu">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1" />
                <circle cx="19" cy="12" r="1" />
                <circle cx="5" cy="12" r="1" />
              </svg>
            </button>
            <div class="dropdown-menu" :class="{ hidden: !showMenu }">
              <button class="dropdown-item" @click="exportSecrets">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>导出备份</span>
              </button>
              <button class="dropdown-item" @click="triggerImport">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>导入备份</span>
              </button>
              <div class="dropdown-divider" />
              <button class="dropdown-item" @click="showAboutModal = true; showMenu = false">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>关于</span>
              </button>
              <div class="dropdown-divider" />
              <button class="dropdown-item" @click="openOptionsPage">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
                <span>打开管理页面</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <!-- 主内容 -->
      <main class="main-content">
        <!-- 主页 -->
        <div class="page" :class="{ active: currentPage === 'home' }">
          <!-- 搜索框 -->
          <div class="search-box">
            <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input type="text" v-model="searchQuery" placeholder="搜索站点或名称...">
          </div>

          <!-- 当前网站匹配 -->
          <div v-if="currentSiteMatches.length > 0" class="current-site-match">
            <div class="match-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>当前网站</span>
            </div>
            <div class="current-site-codes">
              <div v-for="secret in currentSiteMatches" :key="secret.id" class="secret-card" @click="copyCode(secret)">
                <div class="secret-card-header">
                  <div class="secret-card-info">
                    <div class="secret-card-name">{{ secret.name || secret.site }}</div>
                    <div class="secret-card-site">{{ secret.site }}</div>
                  </div>
                  <div class="secret-card-menu">
                    <button class="menu-btn" title="编辑" @click.stop="showEditPage(secret)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div class="secret-card-code">
                  <span class="otp-display">{{ formatCode(codeData.get(secret.id)?.code || '------') }}</span>
                  <span class="timer-badge" :class="{ warning: codeData.get(secret.id)?.remainingSeconds <= 10, danger: codeData.get(secret.id)?.remainingSeconds <= 5 }">
                    <span class="timer-progress" :style="{ width: ((codeData.get(secret.id)?.remainingSeconds || 30) / 30 * 100) + '%' }" />
                    <span class="timer-text">{{ codeData.get(secret.id)?.remainingSeconds || 30 }}s</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- 搜索结果 -->
          <div v-if="searchQuery" class="search-results">
            <div class="section-header">
              <span>搜索结果</span>
              <span class="count-badge">{{ searchResults.length }}</span>
            </div>
            <div v-if="searchResults.length > 0" class="secrets-list">
              <div v-for="secret in searchResults" :key="secret.id" class="secret-card" @click="copyCode(secret)">
                <div class="secret-card-header">
                  <div class="secret-card-info">
                    <div class="secret-card-name">{{ secret.name || secret.site }}</div>
                    <div class="secret-card-site">{{ secret.site }}</div>
                  </div>
                  <div class="secret-card-menu">
                    <button class="menu-btn" title="编辑" @click.stop="showEditPage(secret)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button class="menu-btn delete" title="删除" @click.stop="showEditPage(secret)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div class="secret-card-code">
                  <span class="otp-display">{{ formatCode(codeData.get(secret.id)?.code || '------') }}</span>
                  <span class="timer-badge" :class="{ warning: codeData.get(secret.id)?.remainingSeconds <= 10, danger: codeData.get(secret.id)?.remainingSeconds <= 5 }">
                    <span class="timer-progress" :style="{ width: ((codeData.get(secret.id)?.remainingSeconds || 30) / 30 * 100) + '%' }" />
                    <span class="timer-text">{{ codeData.get(secret.id)?.remainingSeconds || 30 }}s</span>
                  </span>
                </div>
              </div>
            </div>
            <div v-else class="empty-list">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <p>未找到匹配结果</p>
            </div>
          </div>

          <!-- 默认状态 -->
          <div v-if="!searchQuery" class="default-state">
            <!-- 统计卡片 -->
            <div class="stats-card">
              <div class="stats-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div class="stats-info">
                <div class="stats-count">{{ secrets.length }}</div>
                <div class="stats-label">个密钥</div>
              </div>
              <button class="stats-add-btn" title="添加密钥" @click="currentPage = 'create'">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>

            <!-- 快捷操作 -->
            <div class="quick-actions">
              <button class="quick-action-btn" @click="currentPage = 'create'">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
                <span>手动添加</span>
              </button>
              <button class="quick-action-btn" @click="openOptionsPage">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
                <span>管理密钥</span>
              </button>
            </div>

            <!-- 使用提示 -->
            <div class="tips-card">
              <div class="tip-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span>输入关键词搜索验证码</span>
              </div>
              <div class="tip-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>点击验证码可快速复制</span>
              </div>
            </div>
          </div>

          <!-- 空状态 -->
          <div v-if="secrets.length === 0 && !searchQuery" class="empty-state">
            <div class="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3>暂无密钥</h3>
            <p>点击上方添加按钮创建第一个密钥</p>
          </div>
        </div>

        <!-- 创建页 -->
        <div class="page" :class="{ active: currentPage === 'create' }">
          <div class="page-header">
            <button class="back-btn" @click="currentPage = 'home'">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <h2 class="page-title">添加密钥</h2>
          </div>

          <form class="create-form" @submit.prevent="createSecret">
            <div class="form-group">
              <label>密钥</label>
              <input type="text" v-model="createForm.secret" @input="formatSecretInput" placeholder="输入密钥" autocomplete="off" spellcheck="false">
              <span class="hint-text">支持标准 TOTP 密钥格式，如：JBSWY3DPEHPK3PXP</span>
              <span class="error-text">{{ createError }}</span>
            </div>

            <!-- 验证码预览 -->
            <div v-if="previewCode" class="code-preview">
              <div class="preview-label">验证码预览</div>
              <div class="preview-content">
                <span class="preview-code">{{ previewCode }}</span>
                <span class="preview-timer">{{ previewRemaining }}s</span>
              </div>
            </div>

            <div class="form-group">
              <label>验证码长度</label>
              <select v-model="createForm.digits">
                <option :value="6">6 位</option>
                <option :value="8">8 位</option>
              </select>
            </div>

            <div class="form-group">
              <label>目标站点</label>
              <input type="text" v-model="createForm.site" placeholder="例如: github.com" autocomplete="off">
              <span class="hint-text">支持完整 URL 或域名匹配</span>
            </div>

            <div class="form-group">
              <label>名称（可选）</label>
              <input type="text" v-model="createForm.name" placeholder="例如: GitHub" autocomplete="off">
            </div>

            <button type="submit" class="btn-primary">保存密钥</button>
          </form>
        </div>

        <!-- 编辑页 -->
        <div class="page" :class="{ active: currentPage === 'edit' }">
          <div class="page-header">
            <button class="back-btn" @click="currentPage = 'home'">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <h2 class="page-title">编辑密钥</h2>
            <button class="delete-btn" title="删除" @click="deleteSecret">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>

          <form v-if="editingSecret" class="create-form" @submit.prevent="updateSecret">
            <div class="form-group">
              <label>密钥</label>
              <input type="text" v-model="editingSecret.secret" autocomplete="off" spellcheck="false">
            </div>

            <div class="form-group">
              <label>验证码长度</label>
              <select v-model="editingSecret.digits">
                <option :value="6">6 位</option>
                <option :value="8">8 位</option>
              </select>
            </div>

            <div class="form-group">
              <label>目标站点</label>
              <input type="text" v-model="editingSecret.site" autocomplete="off">
            </div>

            <div class="form-group">
              <label>名称（可选）</label>
              <input type="text" v-model="editingSecret.name" autocomplete="off">
            </div>

            <button type="submit" class="btn-primary">保存修改</button>
          </form>
        </div>
      </main>
    </template>

    <!-- Toast -->
    <div class="toast" :class="{ show: toastVisible, success: toastSuccess }">
      {{ toastMessage }}
    </div>

    <!-- 恢复对话框 -->
    <div v-if="showRestoreModal" class="modal">
      <div class="modal-overlay" @click="showRestoreModal = false; pendingImportData = null" />
      <div class="modal-content">
        <div class="modal-header">
          <h3>导入备份</h3>
        </div>
        <div class="modal-body">
          <div class="backup-info">
            <div class="backup-info-item">
              <span class="backup-info-label">备份版本</span>
              <span class="backup-info-value">v{{ pendingImportData?.appVersion || '-' }}</span>
            </div>
            <div class="backup-info-item">
              <span class="backup-info-label">导出时间</span>
              <span class="backup-info-value">{{ pendingImportData?.exportTime ? new Date(pendingImportData.exportTime).toLocaleString('zh-CN') : '-' }}</span>
            </div>
          </div>

          <div class="import-count-info">
            <span>备份包含 <strong>{{ pendingImportData?.count || pendingImportData?.secrets?.length || 0 }}</strong> 个密钥</span>
            <span>当前已有 <strong>{{ secrets.length }}</strong> 个密钥</span>
          </div>

          <div v-if="isEncryptedImport" class="decrypt-section">
            <p class="decrypt-hint">备份已加密，请输入解密密码</p>
            <input type="password" v-model="importPassword" placeholder="输入解密密码" class="decrypt-input">
            <p v-if="importPasswordError" class="decrypt-error">{{ importPasswordError }}</p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" @click="showRestoreModal = false; pendingImportData = null">取消</button>
          <button class="btn-primary" @click="mergeImport">合并</button>
          <button class="btn-danger" @click="overwriteImport">覆盖</button>
        </div>
      </div>
    </div>

    <!-- 关于对话框 -->
    <div v-if="showAboutModal" class="modal">
      <div class="modal-overlay" @click="showAboutModal = false" />
      <div class="modal-content about-modal">
        <div class="modal-header">
          <h3>关于 OpenPass</h3>
          <button class="modal-close" @click="showAboutModal = false">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <p class="about-desc">OpenPass 是一款开源的两步验证管理器扩展，帮助你安全管理 TOTP 验证码。</p>
          <div class="about-info">
            <div class="about-item">
              <span class="about-label">版本</span>
              <span class="about-value">v{{ version }}</span>
            </div>
          </div>
          <div class="about-links">
            <a href="https://github.com/cyber-mule/openpass" target="_blank" class="about-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.835 1.305 3.54.99.105-.78.42-1.305.765-1.605-2.67-.3-5.47-1.33-5.47-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.47 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              GitHub
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* v0.1.0 原版样式 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --primary-color: #4f46e5;
  --primary-hover: #4338ca;
  --primary-light: rgba(79, 70, 229, 0.1);
  --success-color: #10b981;
  --danger-color: #ef4444;
  --warning-color: #f59e0b;
  --bg-color: #f8fafc;
  --card-bg: #ffffff;
  --text-primary: #1e293b;
  --text-secondary: #64748b;
  --text-muted: #94a3b8;
  --border-color: #e2e8f0;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  --radius: 8px;
}

body {
  width: 360px;
  min-height: 480px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background-color: var(--bg-color);
  color: var(--text-primary);
}

.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 480px;
}

/* 头部 */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  z-index: 10;
}

.title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.2s;
}

.icon-btn:hover {
  background: var(--bg-color);
  color: var(--primary-color);
}

/* 下拉菜单 */
.dropdown {
  position: relative;
}

.dropdown-menu {
  position: absolute;
  right: 0;
  top: 100%;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  min-width: 160px;
  padding: 6px 0;
  z-index: 100;
  margin-top: 4px;
}

.dropdown-menu.hidden {
  display: none;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-primary);
  font-size: 13px;
  transition: background 0.2s;
}

.dropdown-item:hover {
  background: var(--bg-color);
}

.dropdown-item svg {
  color: var(--text-secondary);
}

.dropdown-divider {
  height: 1px;
  background: var(--border-color);
  margin: 6px 0;
}

/* 主内容区 */
.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.page {
  display: none;
}

.page.active {
  display: block;
}

/* 搜索框 */
.search-box {
  position: relative;
  margin-bottom: 12px;
}

.search-box input {
  width: 100%;
  padding: 10px 12px 10px 36px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  font-size: 14px;
  color: var(--text-primary);
  background: var(--card-bg);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.search-box input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.search-box input::placeholder {
  color: var(--text-muted);
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
}

/* 当前网站匹配 */
.current-site-match {
  background: var(--primary-light);
  border: 1px solid var(--primary-color);
  border-radius: var(--radius);
  padding: 12px;
  margin-bottom: 12px;
}

.match-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--primary-color);
  margin-bottom: 10px;
}

.current-site-codes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 搜索结果 */
.search-results {
  margin-top: 8px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 10px;
  padding: 0 4px;
}

.count-badge {
  background: var(--border-color);
  color: var(--text-secondary);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
}

.secrets-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 密钥卡片 */
.secret-card {
  background: var(--card-bg);
  border-radius: var(--radius);
  padding: 14px;
  box-shadow: var(--shadow);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  border: 1px solid transparent;
}

.secret-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.secret-card:active {
  transform: translateY(0);
}

.secret-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}

.secret-card-info {
  flex: 1;
  min-width: 0;
}

.secret-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.secret-card-site {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.secret-card-menu {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.secret-card:hover .secret-card-menu {
  opacity: 1;
}

.menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--text-muted);
  transition: all 0.2s;
}

.menu-btn:hover {
  background: var(--bg-color);
  color: var(--text-primary);
}

.menu-btn.delete:hover {
  background: rgba(239, 68, 68, 0.1);
  color: var(--danger-color);
}

.secret-card-code {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.otp-display {
  font-size: 28px;
  font-weight: 700;
  font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
  letter-spacing: 3px;
  color: var(--primary-color);
  user-select: none;
}

.timer-badge {
  position: relative;
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-color);
  background: var(--primary-light);
  padding: 4px 10px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  min-width: 36px;
}

.timer-badge .timer-progress {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: var(--primary-color);
  opacity: 0.15;
  transition: width 1s linear;
}

.timer-badge .timer-text {
  position: relative;
  z-index: 1;
}

.timer-badge.warning {
  color: var(--warning-color);
  background: rgba(245, 158, 11, 0.1);
}

.timer-badge.warning .timer-progress {
  background: var(--warning-color);
}

.timer-badge.danger {
  color: var(--danger-color);
  background: rgba(239, 68, 68, 0.1);
  animation: pulse 1s ease-in-out infinite;
}

.timer-badge.danger .timer-progress {
  background: var(--danger-color);
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

/* 默认状态 */
.default-state {
  padding: 12px 0;
}

.stats-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: linear-gradient(135deg, var(--primary-color) 0%, #7c3aed 100%);
  padding: 16px;
  border-radius: var(--radius);
  margin-bottom: 16px;
  color: white;
}

.stats-icon {
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stats-info {
  flex: 1;
}

.stats-count {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
}

.stats-label {
  font-size: 12px;
  opacity: 0.9;
  margin-top: 2px;
}

.stats-add-btn {
  width: 40px;
  height: 40px;
  background: rgba(255, 255, 255, 0.2);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.stats-add-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.quick-actions {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.quick-action-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 10px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-secondary);
}

.quick-action-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
  background: var(--primary-light);
}

.quick-action-btn svg {
  color: var(--primary-color);
}

.quick-action-btn span {
  font-size: 12px;
  font-weight: 500;
}

.tips-card {
  background: var(--bg-color);
  border-radius: var(--radius);
  padding: 12px 14px;
}

.tip-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.tip-item svg {
  flex-shrink: 0;
  color: var(--primary-color);
  opacity: 0.7;
}

/* 空状态 */
.empty-list {
  text-align: center;
  padding: 40px 16px;
  color: var(--text-muted);
}

.empty-list svg {
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-list p {
  font-size: 14px;
}

.empty-state {
  text-align: center;
  padding: 32px 20px;
}

.empty-icon {
  margin-bottom: 12px;
  opacity: 0.4;
  color: var(--text-muted);
}

.empty-state h3 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--text-primary);
}

.empty-state p {
  font-size: 12px;
  color: var(--text-muted);
}

/* 页面头部 */
.page-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.2s;
}

.back-btn:hover {
  background: var(--bg-color);
  color: var(--text-primary);
}

.page-title {
  flex: 1;
  font-size: 16px;
  font-weight: 600;
}

.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--text-muted);
  transition: all 0.2s;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  color: var(--danger-color);
}

/* 表单 */
.create-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.form-group input,
.form-group select {
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  font-size: 14px;
  color: var(--text-primary);
  background: var(--card-bg);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.form-group input::placeholder {
  color: var(--text-muted);
}

.hint-text {
  font-size: 11px;
  color: var(--text-muted);
}

.error-text {
  font-size: 11px;
  color: var(--danger-color);
  min-height: 16px;
}

/* 验证码预览 */
.code-preview {
  background: var(--primary-light);
  border-radius: var(--radius);
  padding: 10px 12px;
  margin-bottom: 4px;
}

.preview-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.preview-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.preview-code {
  font-size: 20px;
  font-weight: 700;
  font-family: 'SF Mono', 'Consolas', monospace;
  color: var(--primary-color);
}

.preview-timer {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-color);
  background: rgba(79, 70, 229, 0.2);
  padding: 2px 8px;
  border-radius: 10px;
}

.btn-primary {
  padding: 12px 16px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-secondary {
  padding: 10px 16px;
  background: var(--bg-color);
  color: var(--text-secondary);
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-danger {
  padding: 10px 16px;
  background: var(--danger-color);
  color: white;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

/* Toast */
.toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%) translateY(100px);
  background: var(--text-primary);
  color: white;
  padding: 10px 20px;
  border-radius: var(--radius);
  font-size: 13px;
  z-index: 1000;
  transition: transform 0.3s;
}

.toast.show {
  transform: translateX(-50%) translateY(0);
}

.toast.success {
  background: var(--success-color);
}

/* 设置引导 */
.setup-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 480px;
  padding: 40px 20px;
  text-align: center;
}

.setup-icon {
  margin-bottom: 16px;
  color: var(--primary-color);
}

.setup-prompt h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.setup-prompt p {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 20px;
}

/* Modal */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
}

.modal-content {
  position: relative;
  background: var(--card-bg);
  border-radius: 12px;
  width: 90%;
  max-width: 340px;
  max-height: 90%;
  overflow: auto;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
  font-size: 16px;
  font-weight: 600;
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--text-muted);
}

.modal-close:hover {
  background: var(--bg-color);
  color: var(--text-primary);
}

.modal-body {
  padding: 16px 20px;
}

.modal-footer {
  display: flex;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color);
}

/* 备份信息 */
.backup-info {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.backup-info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.backup-info-label {
  font-size: 11px;
  color: var(--text-muted);
}

.backup-info-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.import-count-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

.import-count-info strong {
  color: var(--primary-color);
}

.decrypt-section {
  margin-top: 12px;
}

.decrypt-hint {
  font-size: 12px;
  color: var(--danger-color);
  margin-bottom: 8px;
}

.decrypt-input {
  width: 100%;
  padding: 10px 12px;
  border: 2px solid var(--border-color);
  border-radius: var(--radius);
  font-size: 14px;
}

.decrypt-input:focus {
  outline: none;
  border-color: var(--primary-color);
}

.decrypt-error {
  font-size: 12px;
  color: var(--danger-color);
  margin-top: 6px;
}

/* 关于 */
.about-desc {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

.about-info {
  margin-bottom: 16px;
}

.about-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
}

.about-label {
  font-size: 13px;
  color: var(--text-muted);
}

.about-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.about-links {
  display: flex;
  gap: 12px;
}

.about-link {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--primary-color);
  text-decoration: none;
}

.about-link:hover {
  text-decoration: underline;
}
</style>