# NodeWarden 参考研究（2026-09-11）

> 对象：https://github.com/shuaiplus/nodewarden（本地 /Users/taowen/project/nodewarden）
> Bitwarden 兼容密码服务器，Cloudflare Workers + D1 + R2/KV 双后端 + 2×Durable Object + cron + Preact PWA。
> 与 onenav-workers 同平台同模式（单用户自托管），威胁模型重一个数量级。

## Top 5 借鉴清单（按性价比）

| # | 借鉴项 | 对应位置 | 工作量 |
|---|---|---|---|
| 1 | **每日书签 JSON 自动备份到 R2**：cron 每日一次 → 全表 SELECT → JSON + sha256 前 5 位进文件名 → R2 put → list 删旧保 30 → options 表记 lastSuccessAt；管理端列出/下载/恢复 | 新增项（插 Phase 2 前或并行） | ~1-2 天 |
| 2 | **登录防爆破 + 统一安全响应头 + 集中限额**：D1 UPSERT 失败锁定（10 次锁 2 分钟）+ CF-Connecting-IP/IPv6 /64 折叠；Hono 中间件注入 nosniff/Referrer-Policy/X-Frame-Options/CSP；建 limits.ts | 现有鉴权加固（登录端点目前无防爆破） | ~半天 |
| 3 | **R2 图标上传防御细节**：Content-Length 预检 + 集中限额 + content-type 白名单 + 服务端生成对象键（防路径注入）+ customMetadata 关联 + 不可变键配 immutable 缓存 | Phase 3 | 随 Phase 3 顺手 |
| 4 | **PWA 构建期生成 service worker**：构建产物 URL 列表 sha256 做 cache version、app-shell 回退、API 路径永不缓存、sw 注册 18 行 | Phase 4 | ~半天 |
| 5 | **schema 版本门控**：options 表存 schema.version，启动校验表结构与期望一致（不盲跑 DDL），漂移时报错可读；备份/格式契约处写 "WHEN CHANGING THIS" 注释 | 双源模式治理 | ~半天 |

## 各主题结论摘要

- **备份（最重要）**：NodeWarden 的 cron 是 5 分钟节拍器（业务频率由 per-destination intervalHours + 时区时隙计算决定）；Durable Object 做租约锁防手动/定时/恢复并发；ZIP store-only（CPU 限额）+ 文件名内嵌 SHA-256 前缀自校验；上传后 stat 验证 + 3 次重试；保留 30 份。**移植裁剪**：单用户每日一次无并发竞争 → 不要 DO/锁/加密信封/外部 S3/WebDAV，直接 R2。
- **R2 附件**：双后端抽象（R2 优先 KV 兜底）；两步式上传（元数据落库 → 5 分钟 JWT 上传 URL）+ 一次性下载 token（jti 落 D1 消费）。**移植裁剪**：图标公开且上传者已鉴权 → 一步 POST multipart 即可，抄防御细节不抄 token 机制。
- **鉴权安全**：双层 PBKDF2（防拖库即登录）、JWT security_stamp、WebAuthn/TOTP——密码管理器威胁模型，不抄。**抄**：D1 UPSERT 登录锁定、getClientIdentifier（IP→IPv6/64 折叠）、applyCors 式统一安全头。
- **schema**：运行时自举 DDL（版本门控）+ migrations/ 镜像 + 备份契约 = 三源纪律硬扛。我们双源已有 drift 测试兜底，补"版本门控 + 启动校验"更稳。
- **前端**：Preact + wouter + TanStack Query + 纯 CSS 变量暗色（与我们主题 tokens 同思路）；shared/ 双端共享类型（vite alias）；i18n 校验脚本；demo 模式 alias 替换 + Pages 部署。PWA 方案直接搬。
- **Workers 配置**：`run_worker_first=true` + `html_handling="none"`——同域混 API+SPA 且要给静态响应加头/藏前端时才需要；我们 assets-first 够用，备档。DO migrations tag 只增不改。
- **运维**：RELEASE_NOTES.md 顶部 15 行写作规则注释（纪律固化进文件）；README fork+connect 零命令行部署引导；契约型测试（测官方客户端兼容而非实现细节——对应我们的 PHP 格式兼容测试）；ensure-kv.cjs 幂等资源脚本。

## 明确不抄

WebAuthn/2FA、SignalR 推送（NotificationsHub 925 行）、多用户、KV 双后端、备份凭据双信封加密、SSRF 矩阵、Preact 迁移——服务密码管理器/规模化的复杂度，单用户书签站用不上。

## 关键源码索引（/Users/taowen/project/nodewarden/）

- 备份：src/index.ts(scheduled)、src/durable/backup-transfer-runner.ts、src/handlers/backup.ts、src/services/backup-{archive,config,uploader}.ts、src/router-admin-backup.ts
- 附件：src/handlers/attachments.ts、src/services/blob-store.ts、src/utils/direct-upload.ts
- 安全：src/services/{auth,ratelimit}.ts、src/utils/response.ts、src/config/limits.ts
- schema：src/services/{storage,storage-schema}.ts
- 前端：webapp/vite.config.ts(PWA 插件 9-237)、webapp/src/lib/{i18n,pwa,demo}.ts
