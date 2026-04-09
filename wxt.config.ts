import { defineConfig } from 'wxt';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';

/**
 * 读取或生成固定扩展 ID key
 * key 用于固定 chrome.storage.local 的绑定 ID，避免开发者模式重新加载时丢失数据
 * 线上商店版本由 Google 签名自动生成，不受此影响
 */
function getExtensionKey(): string {
  const keyFile = './extension.key';

  if (existsSync(keyFile)) {
    return readFileSync(keyFile, 'utf-8').trim();
  }

  // 首次运行，生成新 key 并保存到本地
  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const key = publicKey.toString('base64').replace(/\n/g, '');
  writeFileSync(keyFile, key, 'utf-8');
  console.log('[WXT] Generated new extension key, saved to extension.key');
  return key;
}

export default defineConfig({
  srcDir: 'src',
  manifest: {
    manifest_version: 3,
    name: 'OpenPass',
    version: '0.1.0',
    description: '开源的 2FA 认证工具，本地存储密钥，一键生成验证码',
    author: 'cyber-mule',
    homepage_url: 'https://github.com/cyber-mule/openpass',
    key: getExtensionKey(),
    permissions: [
      'storage',
      'activeTab',
      'tabs',
      'contextMenus',
      'notifications',
      'alarms'
    ],
    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png'
    }
  },
  modules: ['@wxt-dev/module-vue'],
  imports: true
});
