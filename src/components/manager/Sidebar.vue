<script setup lang="ts">
interface Props {
  currentPage: string;
}

interface Emits {
  (e: 'navigate', page: string): void;
}

defineProps<Props>();
defineEmits<Emits>();

const navItems = [
  { id: 'secrets', label: '密钥管理', icon: 'key' },
  { id: 'settings', label: '设置', icon: 'settings' }
];
</script>

<template>
  <aside class="w-64 bg-gray-900 text-white min-h-screen">
    <div class="p-6">
      <h1 class="text-xl font-bold">OpenPass</h1>
      <p class="text-xs text-gray-400 mt-1">2FA 管理器</p>
    </div>

    <nav class="mt-4">
      <a
        v-for="item in navItems"
        :key="item.id"
        href="#"
        class="flex items-center px-6 py-3 text-sm transition-colors"
        :class="currentPage === item.id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'"
        @click.prevent="$emit('navigate', item.id)"
      >
        <svg v-if="item.icon === 'key'" class="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
        </svg>
        <svg v-else class="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        {{ item.label }}
      </a>
    </nav>
  </aside>
</template>
