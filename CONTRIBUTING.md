# 贡献指南

感谢你考虑为 TOTPPass 做出贡献！

## 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发指南](#开发指南)
- [提交规范](#提交规范)
- [代码规范](#代码规范)
- [发布流程](#发布流程)

## 行为准则

本项目采用贡献者公约作为行为准则。参与此项目即表示你同意遵守其条款。请阅读 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 了解详情。

## 如何贡献

### 报告 Bug

如果你发现了 Bug，请通过 [Issues](https://github.com/cyber-mule/totppass/issues) 提交报告。

提交 Bug 报告前，请：

1. 搜索现有 Issues，确认该问题尚未被报告
2. 使用 Bug 报告模板填写详细信息
3. 提供复现步骤和环境信息

### 提出新功能

如果你有新功能建议，欢迎通过 [Issues](https://github.com/cyber-mule/totppass/issues) 提交。

提交功能请求时，请：

1. 清晰描述功能及其使用场景
2. 说明该功能解决的问题
3. 如果可能，提供实现建议

### 提交代码

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交变更 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 开发指南

### 环境准备

1. 克隆仓库
   ```bash
   git clone https://github.com/cyber-mule/totppass.git
   cd totppass
   ```

2. 在 Chrome 中加载扩展
   - 打开 `chrome://extensions/`
   - 开启「开发者模式」
   - 点击「加载已解压的扩展程序」
   - 选择项目目录

### 项目结构

```
totppass/
├── .github/              # GitHub 配置
│   ├── ISSUE_TEMPLATE/   # Issue 模板
│   └── workflows/        # GitHub Actions
├── icons/                # 扩展图标
├── background.js         # Service Worker
├── content.js            # 内容脚本
├── content.css           # 内容脚本样式
├── manifest.json         # 扩展配置
├── manager.html          # 管理页面
├── manager.css           # 管理页面样式
├── manager.js            # 管理页面逻辑
├── popup.html            # 弹窗页面
├── popup.css             # 弹窗样式
├── popup.js              # 弹窗逻辑
└── totp.js               # TOTP 算法实现
```

### 开发流程

1. 创建功能分支进行开发
2. 确保代码风格一致
3. 测试所有变更
4. 更新相关文档
5. 提交 Pull Request

### 测试

目前项目没有自动化测试，请手动测试以下场景：

- [ ] 添加新密钥
- [ ] 编辑现有密钥
- [ ] 删除密钥
- [ ] 验证码生成正确性
- [ ] 验证码倒计时
- [ ] 搜索功能
- [ ] 导出/导入备份
- [ ] 右键菜单解析 QR 码
- [ ] 自动检测 2FA 输入框
- [ ] 浮动按钮填充验证码

## 提交规范

本项目采用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

### 提交格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 类型 (type)

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档更新 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 代码重构 |
| `perf` | 性能优化 |
| `test` | 添加测试 |
| `chore` | 构建/工具变更 |

### 范围 (scope)

可选，表示影响范围：

- `popup` - 弹窗相关
- `manager` - 管理页面相关
- `content` - 内容脚本相关
- `background` - Service Worker 相关
- `totp` - TOTP 算法相关
- `ci` - CI/CD 相关

### 示例

```
feat(popup): 添加暗色主题支持
fix(totp): 修复 8 位验证码生成错误
docs: 更新安装说明
chore(ci): 添加自动发布工作流
```

## 代码规范

### JavaScript

- 使用 2 空格缩进
- 使用单引号或双引号保持一致
- 函数和变量使用驼峰命名
- 类使用帕斯卡命名
- 添加必要的注释

### CSS

- 使用 2 空格缩进
- 使用 CSS 变量管理颜色和间距
- 类名使用 kebab-case
- 避免使用 `!important`

### HTML

- 使用 2 空格缩进
- 属性使用双引号
- 添加必要的语义化标签

## 发布流程

本项目使用 GitHub Actions 自动构建发布。

### 版本号规范

遵循 [语义化版本](https://semver.org/lang/zh-CN/)：

- `MAJOR.MINOR.PATCH`
- 例如：`1.0.0` → `1.0.1`（修复）→ `1.1.0`（新功能）→ `2.0.0`（重大变更）

### 发布步骤

1. 更新 `manifest.json` 中的版本号
2. 更新 `manager.html` 和 `popup.html` 中的版本显示
3. 提交变更并推送到 main 分支
4. 创建 GitHub Release
5. GitHub Actions 自动构建并上传 zip 文件

---

再次感谢你的贡献！