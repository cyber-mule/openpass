<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useSecretStore } from '@/stores/secrets';
import { TOTP } from '@/utils/totp';
import { showToast } from '@/utils/ui';

interface Emits {
  (e: 'close'): void;
}

const emit = defineEmits<Emits>();

const authStore = useAuthStore();
const secretStore = useSecretStore();

const welcomePassword = ref('');
const welcomePasswordConfirm = ref('');
const welcomePasswordError = ref('');
const passwordSubmitting = ref(false);

interface StepStatus {
  completed: boolean;
  label: string;
}

const steps = reactive({
  step1: { completed: false, label: '设置主密码' } as StepStatus,
  step2: { completed: false, label: '添加密钥' } as StepStatus,
  step3: { completed: false, label: '配置备份' } as StepStatus
});

const expandedStep = ref<'step1' | 'step2' | 'step3'>('step1');

onMounted(async () => {
  await checkGuideStatus();
});

async function checkGuideStatus() {
  const result = await chrome.storage.local.get([
    'masterPasswordHash',
    'secrets',
    'enableAutoBackup',
    'welcomeCompleted'
  ]);

  steps.step1.completed = !!result.masterPasswordHash;
  steps.step2.completed = result.secrets && result.secrets.length > 0;
  steps.step3.completed = !!result.enableAutoBackup;

  // 自动展开第一个未完成的步骤
  if (!steps.step1.completed) {
    expandedStep.value = 'step1';
  } else if (!steps.step2.completed) {
    expandedStep.value = 'step2';
  } else if (!steps.step3.completed) {
    expandedStep.value = 'step3';
  }
}

async function handleSetPassword() {
  if (!welcomePassword.value) {
    welcomePasswordError.value = '请输入主密码';
    return;
  }

  if (welcomePassword.value.length < 6) {
    welcomePasswordError.value = '密码至少需要 6 个字符';
    return;
  }

  if (welcomePassword.value !== welcomePasswordConfirm.value) {
    welcomePasswordError.value = '两次输入的密码不一致';
    return;
  }

  passwordSubmitting.value = true;

  try {
    const { hash, salt } = await authStore.createMasterPasswordHash
      ? await (authStore as any).createMasterPasswordHash(welcomePassword.value)
      : await import('@/utils/crypto').then(m => m.default.createMasterPasswordHash(welcomePassword.value));

    await chrome.storage.local.set({
      masterPasswordHash: hash,
      masterPasswordSalt: salt,
      isSetupComplete: true
    });

    await authStore.createSession(welcomePassword.value);
    steps.step1.completed = true;
    expandedStep.value = 'step2';

    welcomePassword.value = '';
    welcomePasswordConfirm.value = '';
    welcomePasswordError.value = '';

    showToast('主密码设置成功', 'success');
  } catch (error) {
    welcomePasswordError.value = '设置失败，请重试';
  } finally {
    passwordSubmitting.value = false;
  }
}

function handleSkip() {
  chrome.storage.local.set({ welcomeCompleted: true });
  emit('close');
}

function handleStartUsing() {
  chrome.storage.local.set({ welcomeCompleted: true });
  emit('close');
}

function toggleStep(step: 'step1' | 'step2' | 'step3') {
  expandedStep.value = step;
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <!-- Header -->
        <div class="px-6 py-6 border-b border-gray-200">
          <div class="flex items-center space-x-3">
            <div class="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
              <svg class="w-6 h-6 text-primary-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div>
              <h2 class="text-xl font-bold text-gray-900">欢迎使用 OpenPass</h2>
              <p class="text-sm text-gray-500">只需 3 步即可完成设置</p>
            </div>
          </div>
        </div>

        <!-- Steps -->
        <div class="px-6 py-4 space-y-3">
          <!-- Step 1: 设置主密码 -->
          <div class="border border-gray-200 rounded-lg" :class="{ 'border-primary-500': expandedStep === 'step1' }">
            <button
              class="w-full px-4 py-3 flex items-center justify-between text-left"
              @click="toggleStep('step1')"
            >
              <div class="flex items-center space-x-3">
                <div class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                     :class="steps.step1.completed ? 'bg-green-500 text-white' : 'bg-primary-600 text-white'">
                  {{ steps.step1.completed ? '✓' : '1' }}
                </div>
                <span class="font-medium text-gray-900">设置主密码</span>
                <span class="text-xs px-2 py-0.5 rounded" :class="steps.step1.completed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'">
                  {{ steps.step1.completed ? '已完成' : '必填' }}
                </span>
              </div>
              <svg class="w-5 h-5 text-gray-400 transition-transform" :class="{ 'rotate-180': expandedStep === 'step1' }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div v-show="expandedStep === 'step1' && !steps.step1.completed" class="px-4 pb-4 border-t border-gray-200 pt-4">
              <div class="space-y-3">
                <div>
                  <label class="form-label">主密码</label>
                  <input
                    v-model="welcomePassword"
                    type="password"
                    placeholder="至少 6 个字符"
                    class="input mt-1"
                    @keydown.enter="welcomePasswordConfirm.focus()"
                  />
                </div>
                <div>
                  <label class="form-label">确认密码</label>
                  <input
                    v-model="welcomePasswordConfirm"
                    type="password"
                    placeholder="再次输入主密码"
                    class="input mt-1"
                    @keydown.enter="handleSetPassword"
                  />
                </div>
                <p v-if="welcomePasswordError" class="text-sm text-red-600">{{ welcomePasswordError }}</p>
                <button
                  class="btn-primary w-full"
                  :disabled="passwordSubmitting"
                  @click="handleSetPassword"
                >
                  {{ passwordSubmitting ? '设置中...' : '设置主密码' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Step 2: 添加密钥 -->
          <div class="border border-gray-200 rounded-lg">
            <button
              class="w-full px-4 py-3 flex items-center justify-between text-left"
              @click="toggleStep('step2')"
            >
              <div class="flex items-center space-x-3">
                <div class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                     :class="steps.step2.completed ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-700'">
                  {{ steps.step2.completed ? '✓' : '2' }}
                </div>
                <span class="font-medium text-gray-900">添加第一个密钥</span>
                <span class="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700">推荐</span>
              </div>
              <svg class="w-5 h-5 text-gray-400 transition-transform" :class="{ 'rotate-180': expandedStep === 'step2' }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div v-show="expandedStep === 'step2' && !steps.step2.completed" class="px-4 pb-4 border-t border-gray-200 pt-4">
              <p class="text-sm text-gray-600 mb-3">
                从支持 2FA 的网站获取密钥后，点击添加
              </p>
              <button
                class="btn-primary w-full"
                @click="emit('close')"
              >
                去添加密钥
              </button>
            </div>
          </div>

          <!-- Step 3: 配置备份 -->
          <div class="border border-gray-200 rounded-lg">
            <button
              class="w-full px-4 py-3 flex items-center justify-between text-left"
              @click="toggleStep('step3')"
            >
              <div class="flex items-center space-x-3">
                <div class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                     :class="steps.step3.completed ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-700'">
                  {{ steps.step3.completed ? '✓' : '3' }}
                </div>
                <span class="font-medium text-gray-900">配置自动备份</span>
                <span class="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700">推荐</span>
              </div>
              <svg class="w-5 h-5 text-gray-400 transition-transform" :class="{ 'rotate-180': expandedStep === 'step3' }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div v-show="expandedStep === 'step3' && !steps.step3.completed" class="px-4 pb-4 border-t border-gray-200 pt-4">
              <p class="text-sm text-gray-600 mb-3">
                启用自动备份，防止数据丢失
              </p>
              <button
                class="btn-secondary w-full"
                @click="emit('close')"
              >
                去设置备份
              </button>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <button class="text-sm text-gray-500 hover:text-gray-700" @click="handleSkip">
            跳过引导
          </button>
          <button
            class="btn-primary"
            :disabled="!steps.step1.completed"
            @click="handleStartUsing"
          >
            开始使用
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
