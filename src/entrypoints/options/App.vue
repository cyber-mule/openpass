<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useSecretStore } from '@/stores/secrets';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';
import Sidebar from '@/components/manager/Sidebar.vue';
import SecretTable from '@/components/manager/SecretTable.vue';
import SecretModal from '@/components/manager/SecretModal.vue';
import BackupPanel from '@/components/manager/BackupPanel.vue';
import SettingsPanel from '@/components/manager/SettingsPanel.vue';
import AboutPanel from '@/components/manager/AboutPanel.vue';
import WelcomeGuide from '@/components/manager/WelcomeGuide.vue';
import type { Secret } from '@/stores/secrets';
import { showToast } from '@/utils/ui';

const authStore = useAuthStore();
const secretStore = useSecretStore();

const currentPage = ref('secrets');
const showWelcome = ref(false);
const showSecretModal = ref(false);
const editingSecret = ref<Secret | null>(null);
const loading = ref(true);

// 键盘快捷键
const shortcuts = useKeyboardShortcuts({
  onSearch: () => {
    const input = document.querySelector('input[placeholder="搜索密钥..."]') as HTMLInputElement;
    input?.focus();
  },
  onAdd: () => {
    if (currentPage.value === 'secrets') {
      showSecretModal.value = true;
    }
  },
  onSettings: () => currentPage.value = 'settings',
  onHelp: () => currentPage.value = 'about',
  onEdit: () => {
    if (currentPage.value === 'secrets' && secretStore.getFilteredSecrets().length > 0) {
      const first = secretStore.getFilteredSecrets()[0];
      editSecret(first);
    }
  },
  onDelete: async () => {
    if (currentPage.value === 'secrets' && secretStore.getFilteredSecrets().length > 0) {
      const first = secretStore.getFilteredSecrets()[0];
      await secretStore.deleteSecret(first.id);
    }
  },
  onCopy: async () => {
    if (currentPage.value === 'secrets' && secretStore.getFilteredSecrets().length > 0) {
      const first = secretStore.getFilteredSecrets()[0];
      const { TOTP } = await import('@/utils/totp');
      const result = await TOTP.generateCode(first.secret, first.digits || 6);
      await TOTP.copyToClipboard(result.code);
      showToast('验证码已复制', 'success');
    }
  },
  onSelectNext: () => {},
  onSelectPrevious: () => {},
  isModalOpen: () => showSecretModal.value,
  isInputFocused: () => {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }
});

onMounted(async () => {
  await authStore.init();

  // 检查是否首次使用（未设置主密码）
  const setupResult = await chrome.storage.local.get(['masterPasswordHash', 'isSetupComplete']);
  if (!setupResult.masterPasswordHash) {
    // 首次使用，直接显示欢迎引导，不跳转认证页面
    showWelcome.value = true;
    await secretStore.loadSecrets();
    loading.value = false;
    shortcuts.register();
    return;
  }

  if (!authStore.isAuthenticated) {
    const urlParams = new URLSearchParams(window.location.search);
    const redirect = urlParams.get('redirect') || 'options.html';
    window.location.href = `/auth.html?redirect=${redirect}`;
    return;
  }

  await secretStore.loadSecrets();

  // 检查是否需要显示欢迎引导
  const result = await chrome.storage.local.get(['isSetupComplete', 'welcomeCompleted', 'secrets']);
  if (!result.isSetupComplete || !result.welcomeCompleted) {
    showWelcome.value = true;
  }

  shortcuts.register();
  shortcuts.setTotal(secretStore.secrets.length);

  loading.value = false;
});

onUnmounted(() => {
  shortcuts.unregister();
});

function addSecret() {
  editingSecret.value = null;
  showSecretModal.value = true;
}

function editSecret(secret: Secret) {
  editingSecret.value = secret;
  showSecretModal.value = true;
}

async function deleteSecret(secret: Secret) {
  if (confirm(`确定要删除 "${secret.name || secret.site}" 吗？`)) {
    await secretStore.deleteSecret(secret.id);
  }
}

function handleModalClose() {
  showSecretModal.value = false;
  editingSecret.value = null;
}

function handleWelcomeClose() {
  showWelcome.value = false;
}

function handleWelcomeNavigate(page: string) {
  showWelcome.value = false;
  currentPage.value = page;
}
</script>

<template>
  <div v-if="loading" class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="text-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
      <p class="mt-4 text-gray-600">加载中...</p>
    </div>
  </div>

  <div v-else class="flex min-h-screen bg-gray-50">
    <!-- 侧边栏 -->
    <Sidebar :current-page="currentPage" @navigate="currentPage = $event" />

    <!-- 主内容 -->
    <main class="flex-1 p-8 overflow-y-auto">
      <!-- 密钥管理页 -->
      <SecretTable
        v-if="currentPage === 'secrets'"
        @add="addSecret"
        @edit="editSecret"
        @delete="deleteSecret"
      />

      <!-- 备份恢复页 -->
      <BackupPanel v-else-if="currentPage === 'backup'" />

      <!-- 设置页 -->
      <SettingsPanel v-else-if="currentPage === 'settings'" />

      <!-- 关于页 -->
      <AboutPanel v-else-if="currentPage === 'about'" />
    </main>

    <!-- 密钥表单模态框 -->
    <SecretModal
      :open="showSecretModal"
      :editing-secret="editingSecret"
      @close="handleModalClose"
    />

    <!-- 欢迎引导 -->
    <WelcomeGuide
      v-if="showWelcome"
      @close="handleWelcomeClose"
      @navigate="handleWelcomeNavigate"
    />
  </div>
</template>