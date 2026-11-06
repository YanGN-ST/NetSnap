# 贡献指南

感谢你对 **NetSnap** 的兴趣！NetSnap 是一个 Chrome 扩展，用于在浏览器里归档 HAR 文件。这份指南告诉你如何参与贡献。

## 行为准则

参与本项目即表示你同意遵守 [Code of Conduct](./CODE_OF_CONDUCT.md)。请在所有交流中保持尊重。

## 我能贡献什么

- 报 Bug / 提功能建议 → 直接开 [Issue](../../issues)
- 修 Bug / 加功能 → 提 Pull Request
- 改文档 / 改示例 → 同样欢迎提 PR
- 帮忙回答其他用户的 Issue → 任何用户都能参与

## 提 Issue 前

1. 先在 [Issues](../../issues) 搜索关键词，避免重复。
2. 选对应的 Issue 模板（Bug 报告 / 功能建议 / 提问）。
3. Bug 报告请尽量给出复现步骤、浏览器版本、扩展版本和截图/日志。

## 本地开发

### 环境要求

- 任意支持 **Manifest V3** 的 Chromium 浏览器（Chrome / Edge / Brave 等）
- 文本编辑器（推荐 VS Code）
- Git

### 克隆与加载

```bash
git clone https://github.com/YanGN-ST/NetSnap.git
cd NetSnap
```

NetSnap **无需构建步骤**，所有源文件直接被浏览器加载：

1. 打开 `chrome://extensions`
2. 打开右上角"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择本仓库根目录
5. 修改源码后，在扩展卡片上点"刷新"即可重新加载

### 测试

NetSnap 暂无自动化测试。改动请在浏览器里手动验证 HAR 归档的核心流程（点击图标 → 抓取 → 归档 → 查看）。

## 提 Pull Request

1. Fork 本仓库
2. 从 `main` 创建分支：`git checkout -b feat/my-feature`
3. 本地提交，commit message 遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)：
   - `feat: 新增 X` / `fix: 修复 Y` / `docs: 改文档` / `refactor: 重构`
4. 如果改了用户可见行为，更新 [`CHANGELOG.md`](./CHANGELOG.md) 的 `[Unreleased]` 部分
5. 推到自己的 fork：`git push origin feat/my-feature`
6. 在 GitHub 上发起 PR 到 `main`，按 PR 模板勾选自检清单

## 代码风格

- 没有强制 lint 配置。新代码请与周边风格保持一致（缩进、命名、引号）
- 单文件改动尽量小而聚焦
- 避免引入新的运行时依赖

## 版本与发布

- 版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)
- 变更记录见 [`CHANGELOG.md`](./CHANGELOG.md)
- 发布由维护者统一进行，贡献者只需保证 PR 干净、CHANGELOG 已更新

## 联系

- Issue 优先：[GitHub Issues](../../issues)
- 小红书私信：[YanGN 的主页](https://www.xiaohongshu.com/user/profile/66a7e7ae000000001d023641)
- GitHub 主页：<https://github.com/YanGN-ST>
