<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff } from 'lucide-vue-next';

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
</script>

<template>
  <div class="p-5">
    <div class="text-center mb-5">
      <div class="mx-auto w-11 h-11 mb-3 bg-primary/10 rounded-full flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-5 h-5 text-primary">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h1 class="text-lg font-semibold">验证主密码</h1>
      <p class="text-sm text-muted-foreground mt-1">请输入主密码以访问你的密钥</p>
    </div>

    <form @submit.prevent="handleSubmit" class="space-y-4">
      <div class="space-y-2">
        <Label for="password">主密码</Label>
        <div class="relative">
          <Input
            id="password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="输入主密码"
            autocomplete="current-password"
            autofocus
            :disabled="submitting || isLocked"
            class="pr-10"
          />
          <button
            type="button"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            @click="showPassword = !showPassword"
            :disabled="submitting || isLocked"
          >
            <Eye v-if="!showPassword" class="h-4 w-4" />
            <EyeOff v-else class="h-4 w-4" />
          </button>
        </div>
      </div>

      <p v-if="error" class="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
        {{ error }}
      </p>

      <Button
        type="submit"
        class="w-full"
        :disabled="submitting || isLocked"
      >
        {{ submitting ? '验证中...' : (isLocked ? '已锁定' : '解锁') }}
      </Button>

      <p v-if="!isLocked && remainingAttempts < 5" class="text-xs text-center text-muted-foreground">
        剩余尝试次数：<span class="font-medium text-destructive">{{ remainingAttempts }}</span>
      </p>
    </form>
  </div>
</template>