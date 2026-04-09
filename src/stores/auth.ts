import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useStorage } from '@vueuse/core';
import CryptoUtils from '@/utils/crypto';

export interface SessionData {
  sessionKey: string | null;
  expiresAt: number | null;
}

export const useAuthStore = defineStore('auth', () => {
  const sessionKey = ref<string | null>(null);
  const expiresAt = ref<number | null>(null);
  const isAuthenticated = ref(false);
  const authAttempts = useStorage('authAttempts', 0);

  const MAX_ATTEMPTS = 5;
  const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

  async function init() {
    const result = await chrome.storage.local.get(['sessionExpiresAt']);
    if (result.sessionExpiresAt && Date.now() > result.sessionExpiresAt) {
      await clearSession();
      return;
    }

    const sessionResult = await chrome.storage.session.get(['sessionKey']);
    if (sessionResult.sessionKey) {
      sessionKey.value = sessionResult.sessionKey;
      expiresAt.value = result.sessionExpiresAt;
      isAuthenticated.value = true;
    }
  }

  async function login(password: string): Promise<boolean> {
    const result = await chrome.storage.local.get(['masterPasswordHash', 'masterPasswordSalt']);
    if (!result.masterPasswordHash || !result.masterPasswordSalt) {
      throw new Error('系统错误，请重新设置');
    }

    const isValid = await CryptoUtils.verifyMasterPassword(
      password,
      result.masterPasswordHash,
      result.masterPasswordSalt
    );

    if (isValid) {
      await createSession(password);
      await chrome.storage.local.remove(['authAttempts']);
      authAttempts.value = 0;
      return true;
    }

    authAttempts.value++;
    await chrome.storage.local.set({ authAttempts: authAttempts.value });
    return false;
  }

  async function createSession(password: string) {
    sessionKey.value = password;
    expiresAt.value = Date.now() + SESSION_TIMEOUT;

    await chrome.storage.session.set({ sessionKey: password });
    await chrome.storage.local.set({ sessionExpiresAt: expiresAt.value });
    isAuthenticated.value = true;
  }

  async function clearSession() {
    sessionKey.value = null;
    expiresAt.value = null;
    isAuthenticated.value = false;

    await chrome.storage.session.remove(['sessionKey']);
    await chrome.storage.local.remove(['sessionExpiresAt']);
  }

  async function updateActivity() {
    if (sessionKey.value) {
      expiresAt.value = Date.now() + SESSION_TIMEOUT;
      await chrome.storage.local.set({ sessionExpiresAt: expiresAt.value });
    }
  }

  function getRemainingAttempts() {
    return Math.max(0, MAX_ATTEMPTS - authAttempts.value);
  }

  function isLocked() {
    return authAttempts.value >= MAX_ATTEMPTS;
  }

  return {
    sessionKey,
    expiresAt,
    isAuthenticated,
    authAttempts,
    init,
    login,
    createSession,
    clearSession,
    updateActivity,
    getRemainingAttempts,
    isLocked
  };
});
