# 拾事

把消息与资料中的安排整理成事务，核对后放入日历。包含事务箱、详细周历、当天详情、群聊摘要、方案与复盘，以及可暂停的动态风景背景。

## 网页版与本机版

| 功能 | GitHub Pages 网页版 | Windows 本机版 |
| --- | --- | --- |
| 手动新增、编辑、完成事务 | 支持，保存在当前浏览器 | 支持，保存在本机数据库 |
| 月历、详细周历、当天详情、ICS 导出 | 支持 | 支持 |
| 微信消息读取 | 提供本机连接入口，读取在 Windows 页进行 | 仅读取用户明确选择的本机群聊 |
| DeepSeek 整理聊天、文件与方案 | 自己的 API Key 可整理粘贴的文字；文件与方案用本机版 | 配置自己的 API Key 后使用 |
| 提醒 | 页面打开期间的应用内提醒 | 应用内提醒与 Windows 通知 |

网页不直接读取微信或本机数据库，不包含预置 API Key。连接设置页输入自己的密钥即可验证 DeepSeek，默认模型为 V4.1 Flash（接口名 `deepseek-flash`）。密钥仅保留在当前页面内存，刷新或关闭即清除，不写入 localStorage。连接测试和用户主动提交的文字直接发往 DeepSeek 官方接口，可能产生 API 费用。全部整理结果先进入事务箱，保留原文，确认后加入日历；进行中可暂停或结束。网页事务保存在浏览器本地，不与本机版或其他设备自动同步。

## Windows 本机运行

需要 Node.js 22.13 或更新版本、Python 3.12，以及已登录的微信桌面客户端。微信数据库格式可能随版本变化，连接结果以页面实际状态为准。

```powershell
py -3.12 -m venv .wechat-venv
.\.wechat-venv\Scripts\python.exe -m pip install -r scripts/background-requirements.txt
node server.mjs
```

打开 `http://127.0.0.1:4317/`，也可使用 `启动拾事.cmd` 与 `停止拾事.cmd`。

1. 在微信连接页配置自己的 DeepSeek API Key。
2. 选择群聊、消息日期范围与信息类型，保存设置。
3. 在事务箱回查原文，核对日期与对象，再加入日历。
4. 文件导入支持 PDF、DOCX、XLSX、TXT、MD、CSV 与通知截图；方案页可比较建议、预览安排和记录反馈。

服务仅监听 `127.0.0.1`。API Key 使用 Windows CurrentUser DPAPI 加密保存在本机 `data/` 中。采集器使用只读数据库快照与增量队列，不发送微信消息。图片、语音和链接正文不自动采集。所选消息或上传文件的提取文字会在调用 AI 时发送给 DeepSeek。

## 网页构建与部署

```shell
npm run build:pages
npm run preview:pages
```

打开 `http://127.0.0.1:14321/shishi/` 验收。输出 `dist/` 仅包含网页代码、插画素材与浏览器事务逻辑。部署步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 验证

```shell
npm test
npm run check:publish
```

Python 测试：

```powershell
.\.wechat-venv\Scripts\python.exe -m unittest discover -s test -p '*_test.py'
```

## 数据与第三方组件

`data/`、虚拟环境、日志、根目录截图、密钥文件与个人运行记录均不进入仓库，不要强制添加这些文件。站点发布包仅取自 `dist/`。

数据库读取原语的来源与许可证见 `research/background-reader/NOTICE.md` 和随附 `LICENSE`；文档读取组件的说明与许可证见 `vendor/README.md` 与 `vendor/pypdf-licenses/LICENSE`。