<script setup lang="ts">
import { ref, onMounted } from 'vue';
import AuthView from './AuthView.vue';
import SecretList from './SecretList.vue';
import { useAuthStore } from '@/stores/auth';
import { useSecretStore } from '@/stores/secrets';

const authStore = useAuthStore();
const secretStore = useSecretStore();
const currentView = ref<'auth' | 'list' | 'setup'>('auth');
const loading = ref(true);
const pendingSecret = ref<{ secret: string; site: string; name: string } | null>(null);

onMounted(async () => {
  try {
    await authStore.init();
    
    // 检查是否首次使用（未设置主密码）
    const result = await chrome.storage.local.get(['masterPasswordHash', 'isSetupComplete']);
    if (!result.masterPasswordHash) {
      // 首次使用，显示设置引导
      currentView.value = 'setup';
    } else if (authStore.isAuthenticated) {
      currentView.value = 'list';
      await secretStore.loadSecrets();
      await checkPendingSecret();
    }
  } catch (error) {
    console.error('Failed to mount popup:', error);
  } finally {
    loading.value = false;
  }
});

function handleAuthSuccess() {
  currentView.value = 'list';
  secretStore.loadSecrets();
  checkPendingSecret();
}

function openOptionsPage() {
  chrome.runtime.openOptionsPage();
}

async function checkPendingSecret() {
  try {
    const result = await chrome.storage.local.get(['pendingSecret']);
    if (result.pendingSecret) {
      pendingSecret.value = result.pendingSecret;
      await chrome.storage.local.remove(['pendingSecret']);
    }
  } catch (error) {
    console.error('Failed to check pending secret:', error);
  }
}
</script>

<template>
  <div class="w-80 min-h-96 bg-white">
    <div v-if="loading" class="flex items-center justify-center h-32">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
    </div>
    
    <!-- 首次使用引导 -->
    <div v-else-if="currentView === 'setup'" class="p-6 text-center">
      <div class="mx-auto w-12 h-12 mb-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-primary-600">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h1 class="text-xl font-semibold text-gray-900">欢迎使用 OpenPass</h1>
      <p class="text-sm text-gray-500 mt-2 mb-4">请先设置主密码以开始使用</p>
      <button class="btn-primary w-full mb-3" @click="openOptionsPage">
        打开管理页面
      </button>
      <p class="text-xs text-gray-400">在管理页面中，您可以设置主密码并添加密钥</p>
    </div>
    
    <AuthView v-else-if="currentView === 'auth'" @auth-success="handleAuthSuccess" />
    <SecretList v-else :pending-secret="pendingSecret" @secret-added="pendingSecret = null" />
  </div>
</template>
