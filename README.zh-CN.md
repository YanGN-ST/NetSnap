**[English](README.md) | 简体中文**

<p align="center">
  <img src="./assets/readme/hero-zh-v2.svg" width="100%" alt="NetSnap: 录制、选择、导出。">
</p>

录制浏览器网络请求，导出 HAR、Cookie、Token 或请求摘要，无需打开开发者工具。

## 安装

1. 下载或克隆仓库。
2. 在 Chrome 或 Edge 打开 `chrome://extensions`，启用开发者模式。
3. 选择「加载已解压的扩展程序」，选择 `NetSnap` 目录。
4. 将扩展固定到浏览器工具栏。

## 录制和导出

1. 打开并登录目标网站。
2. 打开 NetSnap 并开始录制，保留浏览器显示的调试提示。
3. 执行需要捕获的操作，然后停止录制。
4. 选择 HAR、Cookie 或 Token，选择全部或勾选的请求并下载。

HAR 使用 1.2 格式。Cookie 从请求及响应头提取，Token 从授权头提取，也可下载 Markdown 请求摘要。处理在本地进行，无需构建或安装 npm 依赖。

## 工作方式

扩展通过 `chrome.debugger` 连接当前标签页，记录网络事件并生成所选文件。所需权限包括 debugger、downloads、activeTab 和 storage。权限、限制与故障排查见[使用手册](docs/使用手册.md)。

## 许可

[MIT](LICENSE)
