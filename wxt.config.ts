import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    manifest_version: 3,
    name: 'OpenPass',
    version: '0.1.0',
    description: '开源的 2FA 认证工具，本地存储密钥，一键生成验证码',
    author: 'cyber-mule',
    homepage_url: 'https://github.com/cyber-mule/openpass',
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
  imports: false
});
