# 部署

## GitHub Pages

默认分支是 `main`。在 Settings → Pages → Build and deployment 将 Source 设为 **GitHub Actions**。推送到 `main` 自动构建并部署，也可在 Actions 中手动运行 **Deploy Pages**。

公开仓库可使用 GitHub Free；私有仓库需要支持私有 Pages 的付费套餐。源码私有不代表 Pages 网页也私有，不要将私人数据加入发布文件。

检查、浏览器运行层测试与构建成功后，仅上传 `dist/` 为 Pages artifact，不上传数据库、日志、密钥、Python 读取器或个人截图到站点。

## 发布内容

网页保留原项目布局、背景和日历，手动事务使用当前浏览器的 localStorage 保存。页面打开期间可生成应用内提醒；关闭页面不再检查。清除浏览器存储后，网页事务可能丢失，可导出日历保存已安排事项。

网页可以使用访问者主动填写的 DeepSeek API Key，直接请求官方接口整理粘贴的文字、生成方案、排期与复盘，无需微信或代理服务器。密钥仅保留在当前页面内存，刷新或关闭即清除。浏览器或网络阻止接口请求时会报告连接失败，可改用本机版。

微信后台读取、复杂文件整理与 Windows 系统通知由桌面程序管理。主连接按钮打开已经运行的本机服务页面，备用“启动桌面程序”按钮通过 `shishi://connect` 唤起程序。首次使用先下载 Releases 中的 Shishi-Windows.zip，解压后启动 Shishi.exe。网页不会自动访问 localhost 或同步本机群聊。方案资料支持 TXT/MD/CSV；方案数据库使用 SQL.js 存在当前浏览器中。

## 本地验收

```shell
npm ci
npm run build:pages
npm run preview:pages
```

打开 `http://127.0.0.1:14321/shishi/`。预览使用 `/shishi/` 子路径，与项目 Pages 的路径一致。

本机版仍使用 `node server.mjs`，网页构建不修改本机数据库或配置。
