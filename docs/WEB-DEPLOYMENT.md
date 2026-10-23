# 知屿 Web 版

本 fork 在保留 Electron 桌面版的基础上，新增可独立运行的 Node.js 后端和浏览器入口。Web 版直接调用原有业务服务，无需 Electron、X11 或远程桌面。

## 使用

部署地址：<https://100.78.177.33:8443>，仅绑定服务器的内网地址。当前证书为自签名证书；如需浏览器默认信任，应配置自己的域名及有效证书。

Web 访问密码在服务器首次启动时随机生成，保存于 `/opt/zhiyu/data/initial-password.txt`，仅文件所有者可读。Web 登录和密钥库主密码相互独立。首次进入后由使用者创建工作区和密钥库主密码，部署过程不会预设生产密钥库密码。

这是个人、单所有者工作区：每次登录使旧会话失效并锁库，多个同一会话的浏览器标签页共享工作区；不是多租户产品。退出登录锁库并关闭 SSH、邮件和 AI 私密任务。会话最多 12 小时，15 分钟没有业务请求自动锁库。

支持服务器持久化资产与订阅、续费、文档、加密密钥库及 TOTP、SSH 终端和 SFTP 下载、域名与证书探测、邮件收发及附件、AI 模型问答与知识库、订阅授权和用量、集成服务以及加密备份恢复。AI 和邮箱等外部服务仍需使用者自行配置有效凭据。

上传文件通过浏览器文件选择器提交；导出、附件及 SFTP 文件通过登录态保护的一次性下载地址下载。上传总量最多 32 MiB / 5 个文件，备份恢复也受此上传限制。文件只在隔离的临时目录中处理，恢复票据 15 分钟有效，下载地址 5 分钟有效。

桌面托盘、系统窗口控制、桌面自动更新、本机浏览器扩展配对、本机 v2rayN 及电脑上的 CLI 日志采集不属于服务器 Web 版能力。Web 版不会自动读取使用者电脑上的软件或文件。自动备份目录由服务器固定管理，不能通过网页任意选择服务器目录。

OAuth 会在网页给出授权链接。如授权后浏览器跳到 localhost / 127.0.0.1 且无法打开，将地址栏完整回调链接粘贴到授权提示卡；后端仅转交当前已登记、状态与地址均匹配的回调。AI 订阅原有的手动授权码输入也保留。真实第三方账号授权受提供方接口和账号资格约束，协议测试不等同于真实账号验收。

## 本地运行

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts
npm run web:build
ZHIYU_ORIGIN=http://localhost:8091 npm run web:start
```

默认监听 `127.0.0.1:8091`，数据默认保存到 `web-data/`。生产运行应配置 HTTPS，或在可信的 HTTPS 反向代理后运行。

配置项：`ZHIYU_ORIGIN` 是浏览器访问的完整源地址；`ZHIYU_DATA_DIR` 是数据目录；`HOST` / `PORT` 是监听地址与端口；`ZHIYU_TLS_CERT` / `ZHIYU_TLS_KEY` 配置直接 HTTPS。`ZHIYU_INITIAL_PASSWORD` 可在首次启动前设置至少 16 位初始密码，已有所有者配置后不再生效。

## 服务器维护

源码位于 `/opt/zhiyu/source`，持久化数据、自动备份与 TLS 证书分别位于 `/opt/zhiyu/data`、`/opt/zhiyu/backups` 和 `/opt/zhiyu/tls`。

```sh
cd /opt/zhiyu/source
docker compose -f deploy/zhiyu/compose.yaml up -d --build
docker compose -f deploy/zhiyu/compose.yaml ps
docker compose -f deploy/zhiyu/compose.yaml logs --tail=100 web
```

容器以非 root 用户运行，根文件系统只读，具有重启策略、HTTPS 健康检查与日志轮转。容器内不安装 Electron 运行时。

资产元数据与文档沿用上游存储方式；密钥库由主密码保护。原桌面系统密钥存储在 Web 版由服务器上的随机 AES-256-GCM 密钥代替，密钥文件为 `data/server.key`。直接搬迁整个数据目录必须同时保留该密钥。完整备份可以选择包含系统保护的凭据，并由备份密码加密；Web 访问密码配置不会随业务备份导出或恢复。

遗失 Web 访问密码时，可由服务器所有者停掉容器、将 `data/web-owner.json` 与 `data/initial-password.txt` 移到受保护的备份位置，再启动生成新密码。此操作不重置或找回密钥库主密码。

## 验证

```sh
npm run web:build
npm run web:test
npm run typecheck
npm run lint
npm run desktop:build
```

Web 集成测试使用隔离工作区与 SSH 测试服务器，覆盖鉴权、来源和 CSRF 校验、会话撤销、限速、加密及篡改拒绝、资产和文档持久化、SSE、SSH 输入输出与调整尺寸、文件导入、加密备份下载和检查以及服务重启。

本机运行上游完整测试时，980 项中 934 项通过、43 项失败、3 项跳过。43 项均属于未修改的 `local-usage.test.mjs`，在独立导出的上游原版中同样复现（44 项中 1 项通过、43 项失败）。Web 版不提供该电脑日志采集功能，未为通过测试而修改其安全检查。
