<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuthStore } from '@/stores/auth';

const emit = defineEmits<{
  'auth-success': [];
}>();

const authStore = useAuthStore();
const password = ref('');
const showPassword = ref(false);
const error = ref('');
const submitting = ref(false);

const remainingAttempts = computed(() => authStore.getRemainingAttempts());
const isLocked = computed(() => authStore.isLocked());

const passwordType = computed(() => showPassword.value ? 'text' : 'password');

async function handleSubmit() {
  if (!password.value) {
    error.value = '请输入主密码';
    return;
  }

  if (isLocked.value) {
    error.value = '尝试次数过多，请稍后再试';
    return;
  }

  submitting.value = true;
  error.value = '';

  try {
    const isValid = await authStore.login(password.value);

    if (isValid) {
      password.value = '';
      emit('auth-success');
    } else {
      if (isLocked.value) {
        error.value = '尝试次数过多，请稍后再试';
        submitting.value = false;
        return;
      }
      error.value = '主密码错误';
      password.value = '';
    }
  } catch (err) {
    error.value = '验证失败，请重试';
    console.error('验证失败:', err);
  } finally {
    submitting.value = false;
  }
}

function togglePassword() {
  showPassword.value = !showPassword.value;
}
</script>

<template>
  <div class="p-6">
    <div class="text-center mb-6">
      <div class="mx-auto w-12 h-12 mb-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-primary-600">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h1 class="text-xl font-semibold text-gray-900">验证主密码</h1>
      <p class="text-sm text-gray-500 mt-1">请输入主密码以访问你的密钥</p>
    </div>

    <form @submit.prevent="handleSubmit" class="space-y-4">
      <div class="form-group">
        <label for="password" class="form-label">主密码</label>
        <div class="relative">
          <input
            id="password"
            v-model="password"
            :type="passwordType"
            placeholder="输入主密码"
            autocomplete="current-password"
            autofocus
            class="input pr-10"
            :disabled="submitting || isLocked"
          />
          <button
            type="button"
            class="toggle-password absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
            @click="togglePassword"
            :disabled="submitting || isLocked"
          >
            <svg v-if="!showPassword" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </button>
        </div>
      </div>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <button
        type="submit"
        class="btn-primary w-full"
        :disabled="submitting || isLocked"
      >
        {{ submitting ? '验证中...' : (isLocked ? '已锁定' : '解锁') }}
      </button>

      <p v-if="!isLocked && remainingAttempts < 5" class="text-xs text-center text-gray-500">
        剩余尝试次数：<span class="font-medium text-red-600">{{ remainingAttempts }}</span>
      </p>
    </form>
  </div>
</template>
