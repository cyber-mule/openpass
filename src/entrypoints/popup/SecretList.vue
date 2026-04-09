<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useSecretStore } from '@/stores/secrets';
import { useAuthStore } from '@/stores/auth';
import { showToast } from '@/utils/ui';

interface Props {
  pendingSecret?: { secret: string; site: string; name: string } | null;
}

interface Emits {
  (e: 'secretAdded'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const secretStore = useSecretStore();
const authStore = useAuthStore();
const searchQuery = ref('');
const showAddDialog = ref(false);
const addingSecret = ref(false);

const filteredSecrets = computed(() => secretStore.searchSecrets(searchQuery.value));

onMounted(async () => {
  await authStore.updateActivity();
  startTimers();
  // 如果有待添加的密钥，自动弹出确认框
  if (props.pendingSecret) {
    showAddDialog.value = true;
  }
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

async function confirmAddSecret() {
  if (!props.pendingSecret) return;
  addingSecret.value = true;
  try {
    await secretStore.addSecret({
      site: props.pendingSecret.site.toLowerCase(),
      name: props.pendingSecret.name,
      secret: props.pendingSecret.secret,
      digits: 6,
      period: 30,
      algorithm: 'SHA1'
    });
    showAddDialog.value = false;
    emit('secret-added');
    await secretStore.loadSecrets();
  } catch (error) {
    showToast('添加失败: ' + (error as Error).message, 'error');
  } finally {
    addingSecret.value = false;
  }
}

function cancelAddSecret() {
  showAddDialog.value = false;
  emit('secret-added');
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
        >
          <div class="flex items-center justify-between">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-900 truncate">{{ secret.name || secret.site }}</p>
              <p class="text-xs text-gray-500">{{ secret.site }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="px-4 py-2 border-t border-gray-200 text-xs text-center text-gray-500">
      点击打开管理页面
    </div>

    <!-- 待添加密钥确认框 -->
    <Teleport to="body">
      <div v-if="showAddDialog" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-xl shadow-xl max-w-sm w-full">
          <div class="px-5 py-4 border-b border-gray-200">
            <h3 class="text-base font-semibold text-gray-900">识别到二维码</h3>
          </div>
          <div class="px-5 py-4 space-y-3">
            <div>
              <span class="text-xs text-gray-500">站点</span>
              <p class="text-sm font-medium text-gray-900">{{ pendingSecret?.site || '（未识别）' }}</p>
            </div>
            <div>
              <span class="text-xs text-gray-500">名称</span>
              <p class="text-sm font-medium text-gray-900">{{ pendingSecret?.name || '—' }}</p>
            </div>
            <div>
              <span class="text-xs text-gray-500">密钥</span>
              <p class="text-sm font-mono text-gray-900 truncate">{{ pendingSecret?.secret }}</p>
            </div>
            <p v-if="addingSecret" class="text-xs text-gray-500">添加中...</p>
          </div>
          <div class="px-5 py-3 border-t border-gray-200 flex gap-2">
            <button class="flex-1 btn-secondary" @click="cancelAddSecret" :disabled="addingSecret">取消</button>
            <button class="flex-1 btn-primary" @click="confirmAddSecret" :disabled="addingSecret">
              {{ addingSecret ? '添加中...' : '添加' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
