# 知屿 Web 版

本 fork 在保留 Electron 桌面版的基础上，新增可独立运行的 Node.js 后端和浏览器入口。Web 版直接调用原有业务服务，无需 Electron、X11 或远程桌面。

## 使用

部署地址：<http://100.78.177.33:8091>，仅绑定服务器的内网地址，使用 HTTP。网页登录 Cookie 按协议分为 `zhiyu_session_http` 与 `zhiyu_session_https`，防止历史 Secure Cookie 阻止 HTTP 登录；来源校验、CSRF 校验和登录保护继续保留。

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

默认监听 `127.0.0.1:8091`，数据默认保存到 `web-data/`。当前内网部署使用 HTTP。UUID、复制和旧文档摘要计算已提供 HTTP 兼容；读取系统剪贴板时请使用 Ctrl/Cmd+V 手动粘贴。

配置项：`ZHIYU_ORIGIN` 是浏览器访问的完整源地址；`ZHIYU_DATA_DIR` 是数据目录；`HOST` / `PORT` 是监听地址与端口；`ZHIYU_TLS_CERT` / `ZHIYU_TLS_KEY` 配置直接 HTTPS。`ZHIYU_INITIAL_PASSWORD` 可在首次启动前设置至少 16 位初始密码，已有所有者配置后不再生效。

## 服务器维护

源码位于 `/opt/zhiyu/source`，持久化数据与自动备份分别位于 `/opt/zhiyu/data`、`/opt/zhiyu/backups`。原 TLS 文件保留在 `/opt/zhiyu/tls`，当前 HTTP 配置不加载证书。

```sh
cd /opt/zhiyu/source
docker compose -f deploy/zhiyu/compose.yaml up -d --build
docker compose -f deploy/zhiyu/compose.yaml ps
docker compose -f deploy/zhiyu/compose.yaml logs --tail=100 web
```

容器以非 root 用户运行，根文件系统只读，具有重启策略、HTTP 健康检查与日志轮转。容器内不安装 Electron 运行时。

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

## AI 出站代理

`ZHIYU_AI_PROXY=http://host.docker.internal:7897` 将模型问答、AI 账号授权及 AI/API 用量采集接入宿主机已有的 HTTP 代理。容器通过 `host-gateway` 访问宿主机。`ZHIYU_AI_NO_PROXY` 指定绕过代理的主机，默认包含 localhost、127.0.0.1 和 IPv6 回环地址，因此本地 Embedding 请求不会经过代理。其他集成、SSH、IMAP 等沿用原网络路径。代理不会代填模型 API Key 或授权账号。

## 导入已盘点的资产

盘点只收集主机连接元信息、容器运行状态、镜像、端口、路由域名、GitHub 仓库元信息和已安装 AI 工具；不采集 SSH 私钥、密码、API Key、OAuth 令牌或代理订阅链接。未连接的主机与未绑定的 AI 工具均标记为待核验，未推断套餐、费用、到期日或额度。容器状态仅代表运行状态，不代表业务接口已验收。

盘点数据和导入前备份不提交到 Git。可用下列入口导入现有盘点 JSON；导入合并保留既有资产及凭据，按标识或自然键去重，重复导入不会追加重复记录：

```sh
node scripts/import-web-inventory.mjs ORIGIN INVENTORY_JSON PASSWORD_FILE BEFORE_BACKUP_JSON
```

Web 测试还覆盖代理转发及流式响应、回环地址绕过、HTTP Cookie，以及资产合并幂等性。上文在 macOS 上失败的 43 项本机日志采集测试已在实际 Linux 运行镜像中重新验证，44 项全部通过。

登录回归可从真实浏览器表单开始，预置旧 HTTPS Secure Cookie 后验证 HTTP 登录与会话写入：

```sh
node scripts/web-login-smoke.mjs HTTP_ORIGIN PASSWORD_FILE SCREENSHOT_PATH
```

登录页在跳转前还会检查浏览器是否保存了会话；Cookie 被阻止时保留表单并显示明确原因，不再无提示地返回登录页。密码文件及会话令牌不进入日志或 Git。
