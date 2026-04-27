<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  clearRuntimeErrors,
  getRuntimeErrors,
  type RuntimeErrorEntry
} from '@/utils/runtimeErrors';

const entries = ref<RuntimeErrorEntry[]>([]);
const open = ref(false);
const copying = ref(false);

const hasErrors = computed(() => entries.value.length > 0);

async function loadErrors() {
  entries.value = await getRuntimeErrors();
  if (!entries.value.length) {
    open.value = false;
  }
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

async function handleClear() {
  await clearRuntimeErrors();
  await loadErrors();
}

async function handleCopy() {
  if (!entries.value.length) return;

  copying.value = true;
  try {
    const text = entries.value
      .map((entry) => {
        const sections = [
          `[${formatTime(entry.createdAt)}] ${entry.scope}`,
          entry.message
        ];

        if (entry.details) {
          sections.push(`details: ${entry.details}`);
        }
        if (entry.stack) {
          sections.push(entry.stack);
        }

        return sections.join('\n');
      })
      .join('\n\n');

    await navigator.clipboard.writeText(text);
  } finally {
    copying.value = false;
  }
}

function handleStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName
) {
  if (areaName !== 'local' || !changes.runtimeErrors) {
    return;
  }

  entries.value = Array.isArray(changes.runtimeErrors.newValue)
    ? changes.runtimeErrors.newValue
    : [];
}

onMounted(async () => {
  await loadErrors();
  chrome.storage.onChanged.addListener(handleStorageChange);
});

onUnmounted(() => {
  chrome.storage.onChanged.removeListener(handleStorageChange);
});
</script>

<template>
  <Teleport to="body">
    <button
      v-if="hasErrors"
      class="error-center-trigger"
      type="button"
      @click="open = true"
    >
      运行错误 {{ entries.length }}
    </button>

    <div v-if="open" class="error-center-backdrop" @click.self="open = false">
      <div class="error-center-panel">
        <div class="error-center-header">
          <div>
            <h3>运行错误</h3>
            <p>最近 {{ entries.length }} 条错误，已集成到扩展内便于排查。</p>
          </div>
          <button type="button" class="error-center-close" @click="open = false">关闭</button>
        </div>

        <div v-if="entries.length" class="error-center-list">
          <article v-for="entry in entries" :key="entry.id" class="error-center-item">
            <div class="error-center-meta">
              <strong>{{ entry.scope }}</strong>
              <span>{{ formatTime(entry.createdAt) }}</span>
            </div>
            <p class="error-center-message">{{ entry.message }}</p>
            <p v-if="entry.details" class="error-center-details">{{ entry.details }}</p>
            <pre v-if="entry.stack" class="error-center-stack">{{ entry.stack }}</pre>
          </article>
        </div>

        <div v-else class="error-center-empty">当前没有运行错误。</div>

        <div class="error-center-actions">
          <button type="button" class="error-center-secondary" :disabled="copying || !entries.length" @click="handleCopy">
            {{ copying ? '复制中...' : '复制错误' }}
          </button>
          <button type="button" class="error-center-secondary" :disabled="!entries.length" @click="handleClear">
            清空
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.error-center-trigger {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 11000;
  border: none;
  border-radius: 999px;
  background: #b91c1c;
  color: #fff;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 10px 25px rgba(185, 28, 28, 0.25);
}

.error-center-backdrop {
  position: fixed;
  inset: 0;
  z-index: 11001;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.error-center-panel {
  width: min(860px, 100%);
  max-height: min(80vh, 720px);
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, 0.28);
}

.error-center-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid #e2e8f0;
}

.error-center-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}

.error-center-header p {
  margin: 6px 0 0;
  font-size: 13px;
  color: #64748b;
}

.error-center-close,
.error-center-secondary {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #0f172a;
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
}

.error-center-close:hover,
.error-center-secondary:hover {
  background: #f8fafc;
}

.error-center-close:disabled,
.error-center-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-center-list {
  padding: 20px 24px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.error-center-item {
  border: 1px solid #fecaca;
  background: #fff5f5;
  border-radius: 12px;
  padding: 16px;
}

.error-center-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #7f1d1d;
}

.error-center-message {
  margin: 0;
  color: #111827;
  font-weight: 600;
}

.error-center-details {
  margin: 8px 0 0;
  color: #7c2d12;
  font-size: 13px;
}

.error-center-stack {
  margin: 12px 0 0;
  padding: 12px;
  border-radius: 10px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.error-center-empty {
  padding: 32px 24px;
  color: #64748b;
}

.error-center-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px 24px;
  border-top: 1px solid #e2e8f0;
}
</style>
