<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useSecretStore } from '@/stores/secrets';
import { useAuthStore } from '@/stores/auth';
import { useAutoBackup, type DirectoryInfo } from '@/composables/useAutoBackup';
import { showToast } from '@/utils/ui';
import CryptoUtils from '@/utils/crypto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Key, Shield, Clock, Trash2, FolderOpen, AlertTriangle, Check, X } from 'lucide-vue-next';

const secretStore = useSecretStore();
const authStore = useAuthStore();
const autoBackup = useAutoBackup();

// 自动备份设置
const enableAutoBackup = ref(false);
const backupFrequency = ref<'daily' | 'weekly' | 'monthly'>('weekly');
const enableLocalSnapshot = ref(true);
const enableDirectoryBackup = ref(false);
const lastBackupTime = ref<string | null>(null);
const nextBackupTime = ref<string | null>(null);

// 目录备份
const directoryInfo = ref<DirectoryInfo>({ hasHandle: false, name: null, permission: 'no-handle' });

// 主密码修改
const showPasswordModal = ref(false);
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const passwordError = ref('');

// 备份加密设置
const enableBackupEncryption = ref(false);
const useMasterPasswordForBackup = ref(true);

// 立即备份
const backingUp = ref(false);

onMounted(async () => {
  await loadAllSettings();
});

async function loadAllSettings() {
  await autoBackup.loadSettings();
  enableAutoBackup.value = autoBackup.settings.value.enableAutoBackup;
  backupFrequency.value = autoBackup.settings.value.backupFrequency;
  enableLocalSnapshot.value = autoBackup.settings.value.enableLocalSnapshot;
  enableDirectoryBackup.value = autoBackup.settings.value.enableDirectoryBackup;
  lastBackupTime.value = autoBackup.settings.value.lastBackupTime;
  nextBackupTime.value = autoBackup.settings.value.nextBackupTime;

  // 加载目录信息
  directoryInfo.value = await autoBackup.getDirectoryInfo();

  // 加载备份加密设置
  const encryptionResult = await chrome.storage.local.get([
    'enableBackupEncryption',
    'useMasterPasswordForBackup'
  ]);
  enableBackupEncryption.value = encryptionResult.enableBackupEncryption || false;
  useMasterPasswordForBackup.value = encryptionResult.useMasterPasswordForBackup !== false;
}

// 监听目录备份开关
watch(enableDirectoryBackup, async (enabled) => {
  if (enabled && !directoryInfo.value.hasHandle) {
    // 启用但未选择目录，自动弹出选择
    await handleSelectDirectory();
  }
  await saveBackupSettings();
});

// 格式化时间显示
const formattedLastBackupTime = computed(() => {
  if (!lastBackupTime.value) return '从未备份';

  const lastDate = new Date(lastBackupTime.value);
  const now = new Date();
  const diffMs = now.getTime() - lastDate.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));

  if (diffDays > 0) return `${diffDays} 天前`;
  if (diffHours > 0) return `${diffHours} 小时前`;
  return '刚刚';
});

const formattedNextBackupTime = computed(() => {
  if (!enableAutoBackup.value) return '-';
  if (!nextBackupTime.value) return '待执行';

  const nextDate = new Date(nextBackupTime.value);
  const now = new Date();
  const diffMs = nextDate.getTime() - now.getTime();

  if (diffMs <= 0) return '待执行';

  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const diffHours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  if (diffDays > 0) return `${diffDays} 天后`;
  if (diffHours > 0) return `${diffHours} 小时后`;
  return '即将';
});

async function saveBackupSettings() {
  await autoBackup.saveSettings({
    enableAutoBackup: enableAutoBackup.value,
    backupFrequency: backupFrequency.value,
    enableLocalSnapshot: enableLocalSnapshot.value,
    enableDirectoryBackup: enableDirectoryBackup.value
  });

  // 计算下次备份时间
  if (enableAutoBackup.value) {
    const interval = autoBackup.getBackupInterval(backupFrequency.value);
    const last = lastBackupTime.value ? new Date(lastBackupTime.value) : new Date();
    const next = new Date(last.getTime() + interval);
    nextBackupTime.value = next.toISOString();
    await autoBackup.saveSettings({ nextBackupTime: nextBackupTime.value });
  }

  // 保存加密设置
  await chrome.storage.local.set({
    enableBackupEncryption: enableBackupEncryption.value,
    useMasterPasswordForBackup: useMasterPasswordForBackup.value
  });

  showToast('设置已保存', 'success');
}

async function handleSelectDirectory() {
  const result = await autoBackup.selectDirectory();
  
  if (result.success) {
    directoryInfo.value = await autoBackup.getDirectoryInfo();
    showToast('目录选择成功', 'success');
  } else if (result.error) {
    showToast(result.error, 'error');
  }
}

async function handleRequestPermission() {
  const result = await autoBackup.requestPermission();
  
  if (result.success) {
    directoryInfo.value = await autoBackup.getDirectoryInfo();
    showToast('授权成功', 'success');
  } else if (result.error) {
    showToast(result.error, 'error');
  }
}

async function handleBackupNow() {
  if (secretStore.secrets.length === 0) {
    showToast('没有可备份的密钥', 'warning');
    return;
  }

  backingUp.value = true;
  try {
    let password = null;
    
    // 如果启用加密且使用主密码
    if (enableBackupEncryption.value && useMasterPasswordForBackup.value) {
      password = authStore.sessionKey;
      if (!password) {
        showToast('请先验证主密码', 'error');
        return;
      }
    }

    const results = await autoBackup.performBackup(secretStore.secrets, { password });

    // 更新显示
    lastBackupTime.value = autoBackup.settings.value.lastBackupTime;
    nextBackupTime.value = autoBackup.settings.value.nextBackupTime;

    // 显示结果
    const messages = [];
    if (results.snapshot) messages.push('本地快照已保存');
    if (results.directory?.success) messages.push(`文件已保存: ${results.directory.filename}`);

    if (messages.length > 0) {
      showToast(messages.join('，'), 'success');
    } else if (results.directory && !results.directory.success) {
      if (results.directory.needAuth) {
        directoryInfo.value = await autoBackup.getDirectoryInfo();
      }
      showToast(results.directory.error || '备份失败', 'error');
    }
  } catch (error: any) {
    showToast('备份失败: ' + error.message, 'error');
  } finally {
    backingUp.value = false;
  }
}

function openPasswordModal() {
  currentPassword.value = '';
  newPassword.value = '';
  confirmPassword.value = '';
  passwordError.value = '';
  showPasswordModal.value = true;
}

async function changePassword() {
  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
    passwordError.value = '请填写所有字段';
    return;
  }

  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = '新密码两次输入不一致';
    return;
  }

  if (newPassword.value.length < 6) {
    passwordError.value = '新密码至少需要 6 个字符';
    return;
  }

  try {
    const result = await chrome.storage.local.get(['masterPasswordHash', 'masterPasswordSalt']);
    if (!result.masterPasswordHash || !result.masterPasswordSalt) {
      passwordError.value = '系统错误';
      return;
    }

    const isValid = await CryptoUtils.verifyMasterPassword(
      currentPassword.value,
      result.masterPasswordHash,
      result.masterPasswordSalt
    );

    if (!isValid) {
      passwordError.value = '当前密码错误';
      return;
    }

    // 创建新密码哈希
    const newHash = await CryptoUtils.createMasterPasswordHash(newPassword.value);

    // 如果有加密的密钥，需要重新加密
    const secretsResult = await chrome.storage.local.get(['encryptedSecrets']);
    if (secretsResult.encryptedSecrets) {
      const decrypted = await CryptoUtils.decrypt(secretsResult.encryptedSecrets, currentPassword.value);
      const newEncrypted = await CryptoUtils.encrypt(decrypted, newPassword.value);
      await chrome.storage.local.set({
        masterPasswordHash: newHash.hash,
        masterPasswordSalt: newHash.salt,
        encryptedSecrets: newEncrypted
      });
    } else {
      await chrome.storage.local.set({
        masterPasswordHash: newHash.hash,
        masterPasswordSalt: newHash.salt
      });
    }

    await authStore.createSession(newPassword.value);
    showPasswordModal.value = false;
    showToast('主密码已更新', 'success');
  } catch (error: any) {
    passwordError.value = '修改失败: ' + error.message;
  }
}

async function clearAllSecrets() {
  if (!confirm('确定要清空所有密钥吗？此操作不可撤销！')) return;

  try {
    secretStore.secrets = [];
    await secretStore.saveSecrets();
    await chrome.storage.local.remove(['backupSnapshots']);
    showToast('所有密钥已清空', 'success');
  } catch (error: any) {
    showToast('清空失败: ' + error.message, 'error');
  }
}

async function resetAllData() {
  if (!confirm('确定要重置所有数据吗？此操作将删除所有密钥、设置和主密码！')) return;
  if (!confirm('再次确认：这将永久删除所有数据！')) return;

  try {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await autoBackup.removeHandle();
    showToast('所有数据已重置', 'success');
    window.location.reload();
  } catch (error: any) {
    showToast('重置失败: ' + error.message, 'error');
  }
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold text-foreground">设置</h1>

    <!-- 主密码设置 -->
    <Card>
      <CardHeader>
        <div class="flex items-center gap-4">
          <Key class="w-5 h-5 text-primary" />
          <div>
            <CardTitle>主密码</CardTitle>
            <CardDescription>主密码用于保护密钥数据和管理页面访问</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button variant="secondary" @click="openPasswordModal">
          <Key class="w-4 h-4 mr-2" />
          修改主密码
        </Button>
      </CardContent>
    </Card>

    <!-- 备份加密设置 -->
    <Card>
      <CardHeader>
        <div class="flex items-center gap-4">
          <Shield class="w-5 h-5 text-primary" />
          <div>
            <CardTitle>备份加密</CardTitle>
            <CardDescription>启用后导出的备份文件将加密存储</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>启用备份加密</Label>
            <p class="text-xs text-muted-foreground">导出备份时加密密钥数据</p>
          </div>
          <Switch v-model:checked="enableBackupEncryption" @update:checked="saveBackupSettings" />
        </div>

        <div v-if="enableBackupEncryption" class="ml-4 space-y-4 pl-4 border-l-2 border-primary/20">
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <Label>使用主密码作为备份密码</Label>
              <p class="text-xs text-muted-foreground">无需单独记忆备份密码</p>
            </div>
            <Switch v-model:checked="useMasterPasswordForBackup" @update:checked="saveBackupSettings" />
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- 自动备份设置 -->
    <Card>
      <CardHeader>
        <div class="flex items-center gap-4">
          <Clock class="w-5 h-5 text-primary" />
          <div>
            <CardTitle>自动备份</CardTitle>
            <CardDescription>定期检查并自动备份密钥数据，防止数据丢失</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-6">
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>启用自动备份</Label>
            <p class="text-xs text-muted-foreground">距上次备份超过设定间隔时自动创建备份</p>
          </div>
          <Switch v-model:checked="enableAutoBackup" @update:checked="saveBackupSettings" />
        </div>

        <div v-if="enableAutoBackup" class="space-y-6 ml-4 pl-4 border-l-2 border-primary/20">
          <!-- 备份频率 -->
          <div class="space-y-2">
            <Label>备份频率</Label>
            <select
              v-model="backupFrequency"
              class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              @change="saveBackupSettings"
            >
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </div>

          <!-- 本地快照 -->
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <Label>本地快照</Label>
              <p class="text-xs text-muted-foreground">在浏览器中保留最近 5 个备份版本</p>
            </div>
            <Switch v-model:checked="enableLocalSnapshot" @update:checked="saveBackupSettings" />
          </div>

          <!-- 目录备份 -->
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <div class="space-y-0.5">
                <Label>自动保存到本地目录</Label>
                <p class="text-xs text-muted-foreground">授权目录后自动写入备份文件（需 Chrome 86+）</p>
              </div>
              <Switch v-model:checked="enableDirectoryBackup" />
            </div>

            <!-- 目录状态和选择 -->
            <div v-if="enableDirectoryBackup" class="bg-muted/50 rounded-lg p-4 space-y-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <FolderOpen class="w-4 h-4 text-muted-foreground" />
                  <span class="text-sm">
                    {{ directoryInfo.hasHandle ? `已选择: ${directoryInfo.name}` : '未选择目录' }}
                  </span>
                </div>
                <Button size="sm" variant="secondary" @click="handleSelectDirectory">
                  选择目录
                </Button>
              </div>

              <!-- 权限状态 -->
              <div v-if="directoryInfo.hasHandle" class="flex items-center justify-between text-sm">
                <div class="flex items-center gap-2">
                  <template v-if="directoryInfo.permission === 'granted'">
                    <Check class="w-4 h-4 text-green-500" />
                    <span class="text-green-600">已授权，可自动写入</span>
                  </template>
                  <template v-else-if="directoryInfo.permission === 'prompt'">
                    <AlertTriangle class="w-4 h-4 text-yellow-500" />
                    <span class="text-yellow-600">需要授权才能写入</span>
                  </template>
                  <template v-else-if="directoryInfo.permission === 'denied'">
                    <X class="w-4 h-4 text-red-500" />
                    <span class="text-red-600">权限被拒绝，请重新选择</span>
                  </template>
                </div>
                <Button
                  v-if="directoryInfo.permission !== 'granted'"
                  size="sm"
                  variant="secondary"
                  @click="handleRequestPermission"
                >
                  授权
                </Button>
              </div>
            </div>

            <!-- 备份时间信息 -->
            <div class="bg-muted/50 rounded-lg p-4 space-y-2">
              <div class="flex justify-between text-sm">
                <span class="text-muted-foreground">上次备份</span>
                <span class="font-medium" :title="lastBackupTime ? new Date(lastBackupTime).toLocaleString('zh-CN') : ''">
                  {{ formattedLastBackupTime }}
                </span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-muted-foreground">下次备份</span>
                <span class="font-medium" :class="{ 'text-yellow-600': formattedNextBackupTime === '待执行' }">
                  {{ formattedNextBackupTime }}
                </span>
              </div>
            </div>

            <!-- 立即备份 -->
            <Button variant="secondary" :disabled="backingUp" @click="handleBackupNow">
              <Clock class="w-4 h-4 mr-2" />
              {{ backingUp ? '备份中...' : '立即备份' }}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- 危险操作 -->
    <Card class="border-destructive/50">
      <CardHeader>
        <div class="flex items-center gap-4">
          <Trash2 class="w-5 h-5 text-destructive" />
          <div>
            <CardTitle class="text-destructive">危险操作</CardTitle>
            <CardDescription>以下操作不可撤销，请谨慎使用</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center justify-between py-2 border-b">
          <div>
            <Label>清空所有密钥</Label>
            <p class="text-xs text-muted-foreground">删除所有密钥和备份快照，保留其他设置</p>
          </div>
          <Button variant="destructive" size="sm" @click="clearAllSecrets">
            清空密钥
          </Button>
        </div>

        <div class="flex items-center justify-between py-2">
          <div>
            <Label>重置所有数据</Label>
            <p class="text-xs text-muted-foreground">删除所有数据，恢复到初始状态</p>
          </div>
          <Button variant="destructive" size="sm" @click="resetAllData">
            重置数据
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- 修改密码模态框 -->
    <Dialog v-model:open="showPasswordModal">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改主密码</DialogTitle>
          <DialogDescription>请输入当前密码和新密码</DialogDescription>
        </DialogHeader>

        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label for="current-password">当前密码</Label>
            <Input id="current-password" v-model="currentPassword" type="password" placeholder="输入当前主密码" />
          </div>

          <div class="space-y-2">
            <Label for="new-password">新密码</Label>
            <Input id="new-password" v-model="newPassword" type="password" placeholder="输入新主密码" />
          </div>

          <div class="space-y-2">
            <Label for="confirm-password">确认新密码</Label>
            <Input id="confirm-password" v-model="confirmPassword" type="password" placeholder="再次输入新主密码" />
          </div>

          <p v-if="passwordError" class="text-sm text-destructive">
            {{ passwordError }}
          </p>
        </div>

        <DialogFooter>
          <Button variant="secondary" @click="showPasswordModal = false">取消</Button>
          <Button @click="changePassword">确认修改</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>