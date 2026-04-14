<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface Props {
  currentPage: string;
}

interface Emits {
  (e: 'navigate', page: string): void;
}

defineProps<Props>();
defineEmits<Emits>();

const version = ref('');

onMounted(() => {
  version.value = chrome.runtime.getManifest().version;
});

const navItems = [
  { id: 'secrets', label: '密钥管理', icon: 'key' },
  { id: 'backup', label: '备份恢复', icon: 'backup' },
  { id: 'settings', label: '设置', icon: 'settings' },
  { id: 'about', label: '关于', icon: 'about' }
];
</script>

<template>
  <aside class="w-64 bg-gray-900 text-white min-h-screen flex flex-col">
    <div class="p-6">
      <div class="flex items-center space-x-3">
        <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <div>
          <h1 class="text-xl font-bold">OpenPass</h1>
          <p class="text-xs text-gray-400">2FA 管理器</p>
        </div>
      </div>
    </div>

    <nav class="mt-4 flex-1">
      <a
        v-for="item in navItems"
        :key="item.id"
        href="#"
        class="flex items-center px-6 py-3 text-sm transition-colors"
        :class="currentPage === item.id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'"
        @click.prevent="$emit('navigate', item.id)"
      >
        <!-- Key icon -->
        <svg v-if="item.icon === 'key'" class="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <!-- Backup icon -->
        <svg v-else-if="item.icon === 'backup'" class="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <!-- Settings icon -->
        <svg v-else-if="item.icon === 'settings'" class="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <!-- About icon -->
        <svg v-else-if="item.icon === 'about'" class="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        {{ item.label }}
      </a>
    </nav>

    <div class="p-6 text-xs text-gray-500">
      v{{ version }}
    </div>
  </aside>
</template>