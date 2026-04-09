<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useSecretStore } from '@/stores/secrets';
import { useAuthStore } from '@/stores/auth';

const secretStore = useSecretStore();
const authStore = useAuthStore();
const searchQuery = ref('');
const selectedSecret = ref<string | null>(null);

const filteredSecrets = computed(() => secretStore.searchSecrets(searchQuery.value));

onMounted(async () => {
  await authStore.updateActivity();
  startTimers();
});

onUnmounted(() => {
  stopTimers();
});

let timers: number[] = [];

function startTimers() {
  const interval = window.setInterval(() => {
    updateCodes();
  }, 1000);
  timers.push(interval);
}

function stopTimers() {
  timers.forEach(clearInterval);
  timers = [];
}

async function updateCodes() {
  // 验证码更新逻辑
}

async function copyCode(code: string) {
  await navigator.clipboard.writeText(code);
}

async function handleLogout() {
  await authStore.clearSession();
  window.location.reload();
}
</script>

<template>
  <div class="flex flex-col h-96">
    <!-- Header -->
    <div class="px-4 py-3 border-b border-gray-200">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-lg font-semibold text-gray-900">OpenPass</h2>
        <button
          class="text-gray-500 hover:text-gray-700"
          @click="handleLogout"
          title="退出"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
      <input
        v-model="searchQuery"
        placeholder="搜索密钥..."
        class="input text-sm py-1.5"
      />
    </div>

    <!-- Secret List -->
    <div class="flex-1 overflow-y-auto">
      <div v-if="filteredSecrets.length === 0" class="p-8 text-center text-gray-500">
        <svg class="mx-auto w-12 h-12 mb-2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <p class="text-sm">暂无密钥</p>
      </div>

      <div v-else class="divide-y divide-gray-100">
        <div
          v-for="secret in filteredSecrets"
          :key="secret.id"
          class="p-3 hover:bg-gray-50 cursor-pointer transition-colors"
          @click="selectedSecret = selectedSecret === secret.id ? null : secret.id"
        >
          <div class="flex items-center justify-between">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-900 truncate">{{ secret.name || secret.site }}</p>
              <p class="text-xs text-gray-500">{{ secret.site }}</p>
            </div>
            <button
              class="ml-2 text-primary-600 hover:text-primary-700"
              @click.stop="copyCode(secret.secret)"
              title="复制密钥"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="px-4 py-2 border-t border-gray-200 text-xs text-center text-gray-500">
      点击打开管理页面
    </div>
  </div>
</template>
