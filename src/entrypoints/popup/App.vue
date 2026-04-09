<script setup lang="ts">
import { ref, onMounted } from 'vue';
import AuthView from './AuthView.vue';
import SecretList from './SecretList.vue';
import { useAuthStore } from '@/stores/auth';
import { useSecretStore } from '@/stores/secrets';

const authStore = useAuthStore();
const secretStore = useSecretStore();
const currentView = ref<'auth' | 'list'>('auth');
const loading = ref(true);
const pendingSecret = ref<{ secret: string; site: string; name: string } | null>(null);

onMounted(async () => {
  await authStore.init();
  if (authStore.isAuthenticated) {
    currentView.value = 'list';
    await secretStore.loadSecrets();
    // 检查是否有待添加的密钥（来自右键菜单 QR 识别）
    await checkPendingSecret();
  }
  loading.value = false;
});

function handleAuthSuccess() {
  currentView.value = 'list';
  secretStore.loadSecrets();
  checkPendingSecret();
}

async function checkPendingSecret() {
  const result = await chrome.storage.local.get(['pendingSecret']);
  if (result.pendingSecret) {
    pendingSecret.value = result.pendingSecret;
    // 清除 pendingSecret
    await chrome.storage.local.remove(['pendingSecret']);
  }
}
</script>

<template>
  <div class="w-80 min-h-96 bg-white">
    <div v-if="loading" class="flex items-center justify-center h-32">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
    </div>
    <AuthView v-else-if="currentView === 'auth'" @auth-success="handleAuthSuccess" />
    <SecretList v-else :pending-secret="pendingSecret" @secret-added="pendingSecret = null" />
  </div>
</template>
