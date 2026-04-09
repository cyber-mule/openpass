<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const loading = ref(true);
const isAuthenticated = ref(false);

onMounted(async () => {
  await authStore.init();
  isAuthenticated.value = authStore.isAuthenticated;
  loading.value = false;

  if (!isAuthenticated.value) {
    window.location.href = 'auth.html?redirect=options.html';
  }
});
</script>

<template>
  <div v-if="loading" class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="text-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
      <p class="mt-4 text-gray-600">加载中...</p>
    </div>
  </div>
  <div v-else-if="isAuthenticated" class="min-h-screen bg-gray-50">
    <div class="max-w-6xl mx-auto px-4 py-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-8">OpenPass 管理</h1>
      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-gray-600">管理页面正在迁移中...</p>
        <p class="text-sm text-gray-500 mt-2">原始功能已保留，Vue 组件版本将逐步完善</p>
      </div>
    </div>
  </div>
</template>
