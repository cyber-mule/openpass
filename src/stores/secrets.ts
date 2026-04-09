import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAuthStore } from './auth';
import CryptoUtils from '@/utils/crypto';
import { showToast } from '@/utils/ui';

export interface Secret {
  id: string;
  secret: string;
  site: string;
  name?: string;
  digits?: number;
  period?: number;
  algorithm?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const useSecretStore = defineStore('secrets', () => {
  const secrets = ref<Secret[]>([]);
  const loading = ref(false);
  const searchQuery = ref('');

  async function loadSecrets() {
    loading.value = true;
    try {
      const authStore = useAuthStore();
      const result = await chrome.storage.local.get(['encryptedSecrets', 'secrets']);

      if (result.encryptedSecrets && authStore.sessionKey) {
        const decrypted = await CryptoUtils.decrypt(result.encryptedSecrets, authStore.sessionKey);
        secrets.value = JSON.parse(decrypted);
      } else if (result.secrets) {
        secrets.value = result.secrets;
      } else {
        secrets.value = [];
      }
    } catch (error) {
      console.error('加载密钥失败:', error);
      showToast('加载密钥失败', 'error');
    } finally {
      loading.value = false;
    }
  }

  async function saveSecrets() {
    const authStore = useAuthStore();
    const sitesList = secrets.value.map(s => ({ site: s.site }));

    if (authStore.sessionKey) {
      const encrypted = await CryptoUtils.encrypt(
        JSON.stringify(secrets.value),
        authStore.sessionKey
      );
      await chrome.storage.local.set({
        encryptedSecrets: encrypted,
        sitesList
      });
    } else {
      await chrome.storage.local.set({
        secrets: secrets.value,
        sitesList
      });
    }
  }

  async function addSecret(secretData: Omit<Secret, 'id' | 'createdAt' | 'updatedAt'>) {
    const newSecret: Secret = {
      ...secretData,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    secrets.value.push(newSecret);
    await saveSecrets();
    showToast('密钥已添加', 'success');
    return newSecret;
  }

  async function updateSecret(id: string, updates: Partial<Secret>) {
    const index = secrets.value.findIndex(s => s.id === id);
    if (index === -1) return;

    secrets.value[index] = {
      ...secrets.value[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    await saveSecrets();
    showToast('密钥已更新', 'success');
  }

  async function deleteSecret(id: string) {
    secrets.value = secrets.value.filter(s => s.id !== id);
    await saveSecrets();
    showToast('密钥已删除', 'success');
  }

  function getFilteredSecrets() {
    if (!searchQuery.value) return secrets.value;
    const query = searchQuery.value.toLowerCase();
    return secrets.value.filter(s =>
      s.site.toLowerCase().includes(query) ||
      s.name?.toLowerCase().includes(query) ||
      s.secret.toLowerCase().includes(query)
    );
  }

  function getSecretById(id: string) {
    return secrets.value.find(s => s.id === id);
  }

  async function exportSecrets(password?: string): Promise<Blob> {
    const data = {
      format: 'openpass-backup',
      formatVersion: 1,
      appVersion: chrome.runtime.getManifest().version,
      exportTime: new Date().toISOString(),
      count: secrets.value.length,
      encrypted: !!password,
      secrets: password ? undefined : secrets.value
    };

    if (password) {
      data.encryptedData = await CryptoUtils.encrypt(
        JSON.stringify(secrets.value),
        password
      );
    }

    const json = JSON.stringify(data, null, 2);
    return new Blob([json], { type: 'application/json' });
  }

  async function importSecrets(file: File, password?: string): Promise<number> {
    const text = await file.text();
    const data = JSON.parse(text);

    let importedSecrets: Secret[];

    if (data.encrypted && data.encryptedData && password) {
      const decrypted = await CryptoUtils.decrypt(data.encryptedData, password);
      importedSecrets = JSON.parse(decrypted);
    } else if (data.secrets) {
      importedSecrets = data.secrets;
    } else if (Array.isArray(data)) {
      importedSecrets = data;
    } else {
      throw new Error('无效的备份文件格式');
    }

    // 合并密钥（去重）
    const existingIds = new Set(secrets.value.map(s => s.id));
    let count = 0;

    for (const secret of importedSecrets) {
      if (!secret.id) {
        secret.id = crypto.randomUUID();
      }
      if (!existingIds.has(secret.id)) {
        secrets.value.push(secret);
        existingIds.add(secret.id);
        count++;
      }
    }

    if (count > 0) {
      await saveSecrets();
    }

    return count;
  }

  return {
    secrets,
    loading,
    searchQuery,
    loadSecrets,
    saveSecrets,
    addSecret,
    updateSecret,
    deleteSecret,
    getFilteredSecrets,
    getSecretById,
    exportSecrets,
    importSecrets
  };
});
