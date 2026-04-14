<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { showToast } from '@/utils/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, ChevronDown } from 'lucide-vue-next';

interface Emits {
  (e: 'close'): void;
}

const emit = defineEmits<Emits>();

const authStore = useAuthStore();

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
    const hashResult = await import('@/utils/crypto').then(m => m.default.createMasterPasswordHash(welcomePassword.value));

    await chrome.storage.local.set({
      masterPasswordHash: hashResult.hash,
      masterPasswordSalt: hashResult.salt,
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
  if (steps[step].completed) return;
  expandedStep.value = step;
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
      <Card class="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
              <svg class="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div>
              <CardTitle>欢迎使用 OpenPass</CardTitle>
              <p class="text-sm text-muted-foreground">只需 3 步即可完成设置</p>
            </div>
          </div>
        </CardHeader>

        <CardContent class="space-y-3">
          <!-- Step 1 -->
          <div class="border rounded-lg transition-all" :class="expandedStep === 'step1' ? 'border-primary bg-primary/5' : 'border-border'">
            <button
              class="w-full px-4 py-3 flex items-center justify-between text-left"
              @click="toggleStep('step1')"
            >
              <div class="flex items-center gap-3">
                <div class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                     :class="steps.step1.completed ? 'bg-green-500 text-white' : 'bg-primary text-primary-foreground'">
                  <Check v-if="steps.step1.completed" class="h-3 w-3" />
                  <span v-else>1</span>
                </div>
                <span class="font-medium">设置主密码</span>
                <span class="text-xs px-2 py-0.5 rounded"
                      :class="steps.step1.completed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'">
                  {{ steps.step1.completed ? '已完成' : '必填' }}
                </span>
              </div>
              <ChevronDown class="h-5 w-5 text-muted-foreground transition-transform"
                          :class="{ 'rotate-180': expandedStep === 'step1' && !steps.step1.completed }" />
            </button>

            <div v-if="expandedStep === 'step1' && !steps.step1.completed" class="px-4 pb-4 border-t pt-4 space-y-4">
              <div class="space-y-2">
                <Label for="welcome-password">主密码</Label>
                <Input
                  id="welcome-password"
                  v-model="welcomePassword"
                  type="password"
                  placeholder="至少 6 个字符"
                />
              </div>
              <div class="space-y-2">
                <Label for="welcome-password-confirm">确认密码</Label>
                <Input
                  id="welcome-password-confirm"
                  v-model="welcomePasswordConfirm"
                  type="password"
                  placeholder="再次输入主密码"
                />
              </div>
              <p v-if="welcomePasswordError" class="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                {{ welcomePasswordError }}
              </p>
              <Button class="w-full" :disabled="passwordSubmitting" @click="handleSetPassword">
                {{ passwordSubmitting ? '设置中...' : '设置主密码' }}
              </Button>
            </div>
          </div>

          <!-- Step 2 -->
          <div class="border rounded-lg transition-all"
               :class="expandedStep === 'step2' && !steps.step2.completed ? 'border-primary bg-primary/5' : 'border-border'">
            <button
              class="w-full px-4 py-3 flex items-center justify-between text-left"
              @click="toggleStep('step2')"
            >
              <div class="flex items-center gap-3">
                <div class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                     :class="steps.step2.completed ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'">
                  <Check v-if="steps.step2.completed" class="h-3 w-3" />
                  <span v-else>2</span>
                </div>
                <span class="font-medium">添加第一个密钥</span>
                <span class="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700">推荐</span>
              </div>
              <ChevronDown class="h-5 w-5 text-muted-foreground transition-transform"
                          :class="{ 'rotate-180': expandedStep === 'step2' && !steps.step2.completed }" />
            </button>

            <div v-if="expandedStep === 'step2' && !steps.step2.completed" class="px-4 pb-4 border-t pt-4">
              <p class="text-sm text-muted-foreground mb-3">从支持 2FA 的网站获取密钥后，点击添加</p>
              <Button variant="secondary" class="w-full" @click="emit('close')">去添加密钥</Button>
            </div>
          </div>

          <!-- Step 3 -->
          <div class="border rounded-lg transition-all"
               :class="expandedStep === 'step3' && !steps.step3.completed ? 'border-primary bg-primary/5' : 'border-border'">
            <button
              class="w-full px-4 py-3 flex items-center justify-between text-left"
              @click="toggleStep('step3')"
            >
              <div class="flex items-center gap-3">
                <div class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                     :class="steps.step3.completed ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'">
                  <Check v-if="steps.step3.completed" class="h-3 w-3" />
                  <span v-else>3</span>
                </div>
                <span class="font-medium">配置自动备份</span>
                <span class="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700">推荐</span>
              </div>
              <ChevronDown class="h-5 w-5 text-muted-foreground transition-transform"
                          :class="{ 'rotate-180': expandedStep === 'step3' && !steps.step3.completed }" />
            </button>

            <div v-if="expandedStep === 'step3' && !steps.step3.completed" class="px-4 pb-4 border-t pt-4">
              <p class="text-sm text-muted-foreground mb-3">启用自动备份，防止数据丢失</p>
              <Button variant="secondary" class="w-full" @click="emit('close')">去设置备份</Button>
            </div>
          </div>
        </CardContent>

        <CardFooter class="flex items-center justify-between">
          <Button variant="ghost" @click="handleSkip">跳过引导</Button>
          <Button :disabled="!steps.step1.completed" @click="handleStartUsing">开始使用</Button>
        </CardFooter>
      </Card>
    </div>
  </Teleport>
</template>