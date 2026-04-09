import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAuthStore } from './auth';
import CryptoUtils from '@/utils/crypto';

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

  async function addSecret(secret: Omit<Secret, 'id' | 'createdAt' | 'updatedAt'>) {
    const newSecret: Secret = {
      ...secret,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    secrets.value.push(newSecret);
    await saveSecrets();
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
  }

  async function deleteSecret(id: string) {
    secrets.value = secrets.value.filter(s => s.id !== id);
    await saveSecrets();
  }

  function searchSecrets(query: string) {
    if (!query) return secrets.value;
    const lowerQuery = query.toLowerCase();
    return secrets.value.filter(s =>
      s.site.toLowerCase().includes(lowerQuery) ||
      s.name?.toLowerCase().includes(lowerQuery)
    );
  }

  return {
    secrets,
    loading,
    loadSecrets,
    saveSecrets,
    addSecret,
    updateSecret,
    deleteSecret,
    searchSecrets
  };
});
