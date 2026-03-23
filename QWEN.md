# TOTPPass - Chrome 2FA 验证器扩展

## 项目概述

TOTPPass 是一个 Chrome 浏览器扩展，用于管理 TOTP（Time-based One-Time Password）两步验证密钥。项目解决的核心痛点是：密码分散存储、更换设备后数据丢失、云端同步隐私风险。

**技术栈：**
- Chrome Extension Manifest V3
- 原生 JavaScript（无框架依赖）
- Chrome Storage API（本地存储）
- Web Crypto API（HMAC-SHA1）

**远程仓库：** `git@github.com:cyber-mule/totppass.git`

## 项目结构

```
/home/admin/develop/2fa/
├── manifest.json      # 扩展配置文件
├── background.js      # Service Worker，处理 badge 显示
├── popup.html         # 弹窗 HTML 结构
├── popup.css          # 弹窗样式
├── popup.js           # 弹窗主逻辑（TwoFAApp 类）
├── totp.js            # TOTP 算法实现（RFC 6238）
├── generate-icons.js  # 图标生成脚本（开发工具，不提交）
├── icons/             # 扩展图标
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── README.md          # 项目文档
├── LICENSE            # MIT 许可证
└── .gitignore         # Git 忽略配置
```

## 安装与运行

### 加载扩展（开发者模式）

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择项目目录
4. 扩展图标将出现在浏览器工具栏

### 生成图标（可选）

```bash
node generate-icons.js
```

> 注：图标已生成并提交，通常无需重新生成。

## 核心模块说明

### 1. TOTP 类 (`totp.js`)

实现 RFC 6238 标准的 TOTP 算法：

```javascript
// 生成验证码
const result = await TOTP.generate(secret, digits);
// 返回: { code: '123456', remainingSeconds: 25 }

// 验证密钥格式
TOTP.isValidSecret(secret); // true/false
```

**关键方法：**
- `base32Decode(str)` - Base32 解码
- `hmacSha1(key, message)` - HMAC-SHA1 计算（使用 Web Crypto API）
- `generate(secret, digits, time, period)` - 生成 TOTP 验证码
- `isValidSecret(secret)` - 验证密钥格式（至少 16 个 Base32 字符）

### 2. TwoFAApp 类 (`popup.js`)

弹窗主应用逻辑：

**核心属性：**
- `secrets` - 密钥数组
- `timers` - 计时器 Map（用于刷新验证码）
- `codeData` - 当前验证码 Map

**核心方法：**
- `loadSecrets()` / `saveSecrets()` - 存储操作
- `matchSecrets(url)` - URL 匹配逻辑
- `renderHomePage()` - 渲染主页
- `createSecretCard(secret)` - 创建密钥卡片
- `startCardTimer(secret, card)` - 启动验证码刷新计时器

### 3. Background Service Worker (`background.js`)

处理扩展图标 badge 显示：

- 监听 `chrome.tabs.onUpdated` - 标签页更新
- 监听 `chrome.tabs.onActivated` - 标签页切换
- 监听 `chrome.storage.onChanged` - 存储变化
- `updateBadgeForTab(tabId, url)` - 更新 badge 数量

## 数据结构

### 密钥对象

```javascript
{
  id: '1700000000000',        // 唯一 ID（时间戳）
  secret: 'JBSWY3DPEHPK3PXP', // Base32 密钥
  digits: 6,                  // 验证码长度（6 或 8）
  site: 'github.com',         // 目标站点域名
  name: 'GitHub',             // 显示名称（可选）
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z' // 可选
}
```

### URL 匹配优先级

1. `fullUrl` - 完整地址匹配
2. `fullDomain` - 完整域名匹配
3. `mainDomain` - 主域名匹配
4. `contains` - 包含匹配

## 开发规范

### 代码风格

- 使用 ES6+ 语法
- 类和方法使用 JSDoc 注释
- 变量命名：camelCase
- CSS 变量定义在 `:root` 中

### Git 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式调整
refactor: 重构
chore: 构建/工具变动
```

### 注意事项

1. **密钥安全** - 所有密钥仅存储在 `chrome.storage.local`，不上传云端
2. **计时器清理** - 页面切换时调用 `clearAllTimers()` 防止内存泄漏
3. **Base32 验证** - 密钥必须是有效的 Base32 字符串（A-Z, 2-7）

## 待开发功能

- [ ] 密钥导入/导出功能
- [ ] 加密存储选项
- [ ] 自定义时间周期
- [ ] 暗色主题
- [ ] Firefox 支持

## 相关文档

- [README.md](README.md) - 项目完整文档
- [RFC 6238](https://tools.ietf.org/html/rfc6238) - TOTP 标准
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)