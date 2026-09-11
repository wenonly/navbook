# NodeWarden 参考研究报告

- **日期**：2026-09-11
- **对象**：[shuaiplus/nodewarden](https://github.com/shuaiplus/nodewarden)（本地克隆 `/Users/taowen/project/nodewarden`，v1.8.0，LGPL-3.0）
- **定位**：Cloudflare Workers 上的 Bitwarden 兼容密码服务器——单用户自托管、D1 + R2/KV 双后端 + 2×Durable Object + cron 定时任务 + Preact PWA
- **对照物**：onenav-workers（本项目，`workers/`）——同平台同模式（Workers + D1 + SPA + 单用户），但威胁模型轻一个数量级
- **结论预览**：NodeWarden 是工程质量很高的"Workers 全家桶"参考实现。**最值得借鉴：定时备份骨架（裁掉 80%）与登录限流/安全响应头**；最不值得：WebAuthn、WebSocket 推送、多用户、KV 双后端（密码管理器专属复杂度）

---

## 一、Top 5 借鉴清单（按性价比排序）

| # | 借鉴项 | 来源模块 | 对应我们 | 工作量 |
|---|---|---|---|---|
| 1 | 每日书签 JSON 自动备份到 R2（cron + 校验和文件名 + 保留清理 + 管理端恢复） | backup 全链路 | **新增项**，建议插队 | ~1-2 天 |
| 2 | 登录防爆破（D1 UPSERT 失败锁定 + IPv6 /64 折叠）+ 统一安全响应头 + 集中限额 | ratelimit / response / limits | 现有鉴权加固 | ~半天 |
| 3 | R2 上传的防御细节（Content-Length 预检、类型白名单、服务端生成键、immutable 缓存） | attachments / blob-store | Phase 3 图标上传 | 随 Phase 3 |
| 4 | PWA：构建期生成 Service Worker（产物哈希做缓存版本、API 永不缓存） | vite.config.ts 插件 | Phase 4 | ~半天 |
| 5 | schema 版本门控（启动校验库结构与代码期望一致）+ 契约注释纪律 | storage / storage-schema | 双源模式治理 | ~半天 |

---

## 二、专题深读

### 1. 定时备份（最重要）

#### NodeWarden 的做法

**调度层——cron 是节拍器，不是备份本身**
- `wrangler.toml:15-16`：`crons = ["*/5 * * * *"]` 每 5 分钟敲一次；`src/index.ts:115-125` 的 `scheduled()` 只调 `runScheduledBackupIfDue(env)`
- 真正的到期判断在 `src/services/backup-config.ts:912-938` 的 `isBackupDueNow()`：每个备份目标有自己的 `intervalHours`（默认 24）+ `startTime`（默认 03:00）+ `timezone`（默认 UTC，`shared/backup-schema.ts:9-15`）；当前时间落在"今日时隙 ±5 分钟容差"（`BACKUP_SCHEDULER_WINDOW_MINUTES = 5`，与 cron 周期对应）且 `lastSuccessAt` 早于该时隙才算到期；`hasBackupSlotBetween()`（:868-910）兜底长扫描错过的时隙
- **设计意图**：cron 频率与业务频率解耦——用户配每天/每 12 小时/每周都不用改 cron 表达式，也不怕 Workers cron 偶发漏触发

**互斥层——为什么需要 Durable Object**
- `BackupTransferRunner`（`src/durable/backup-transfer-runner.ts:82`）是基于 DO storage 的租约锁 + 任务执行体：`acquireJob/touchJob/releaseJob`（:91-131），租约 10 分钟、心跳 30 秒，token 不匹配即可抢占——保证手动备份、定时备份、恢复三者永不并发，崩溃后租约自动过期
- Worker 侧所有入口 `idOfName('configured-backup-runner')` 后 POST DO 内部端点（`src/handlers/backup.ts:532-590`），409 = 已有任务在跑
- 妙用：**子请求配额分片**——附件同步每批 40 个发给独立 DO 实例（`handlers/backup.ts:165-281`），因为每次 DO fetch 有独立 ~50 子请求预算，借此绕开单次调用的子请求上限

**归档层——备份什么、什么格式**
- `src/services/backup-archive.ts:477-582`：8 条 SELECT 全量拉表 → `manifest.json`（版本/行数/blob 摘要）+ `db.json`（全表行）→ `zipSync` 打 ZIP
- 两个 Workers 特有的坑：**ZIP 压缩等级 0（store-only）**为 CPU 限额（:30-33 注释）；**文件名内嵌 SHA-256 前 5 位**（`nodewarden_backup_20260711_030000_a1b2c.zip`，:566-568），恢复时免外部清单自校验（`verifyBackupArchiveFileNameChecksum`，:181-184）
- 大小防线：归档 64MB / 条目 1 万 / db.json 32MB（:34-38）；解压侧 zip-slip + 条目数 + 总量三重过滤（:223-245）
- 敏感数据契约（:12-24）：设备/会话/一次性 token 等运行时状态**永不进备份**

**上传层——存哪里、保留几份**
- 目标是**外部 S3（手写 SigV4）或 WebDAV**（`backup-uploader.ts:697-848`）——不是 R2（密码库需要"数据离开 Cloudflare 账号"的异地容灾）
- 上传后强制验证：先 stat 比大小，失败则整包下载复核，不过就删掉重传，最多 3 次（`handlers/backup.ts:402-432`）
- 保留策略：list 根目录按时间排序删到 `retentionCount`（默认 30，上限 1000）（`backup-uploader.ts:824-839`）
- 附件增量：远端索引文件 `attachments/.nodewarden-attachment-index.v1.json`，只传 size 变化的 blob
- 备份目标凭据双信封加密（runtime AES-GCM+HKDF / portable DEK+RSA-OAEP，`backup-settings-crypto.ts:184-239`）；API 返回时打码 `********`（`backup-config.ts:623-646`）
- 备份端点 URL 整套 SSRF 防护（localhost 变体/私网 v4v6/metadata IP/nip.io 等，`backup-config.ts:71-226`）

**恢复流程**
- 管理端 REST 全套（`src/router-admin-backup.ts:14-99`）：settings GET/PUT、run、remote 浏览、download、integrity、restore、delete、import
- 高危操作全部要求主密码哈希再验证（`handlers/backup.ts:67-78`）；凭据只走 POST body 不走 URL（防泄漏进日志/Referer，router 注释明说）
- 恢复也进 DO 拿锁：下载 → 文件名校验和 → `importAndAuditRemoteBackupFile`（:696-780）→ 审计日志
- 进度经 `NotificationsHub` DO 的 WebSocket 推给前端

#### 值不值得抄：**改造后抄（大幅裁剪）**

书签数据价值密度远低于密码库，**备份到自己账号的 R2 即可**；单用户每日一次没有并发竞争 → 不要 DO/租约锁/加密信封/外部目标/时区时隙数学。

#### 移植最小方案草图

```
绑定：[triggers] crons = ["23 3 * * *"] + [[r2_buckets]] BACKUPS
scheduled()：读 options 表 backup.state.v1（lastSuccessAt）
  → SELECT 分类+链接（+后续主题配置）为 JSON
  → 文件名内嵌 sha256 前 5 位：backups/onenav_backup_YYYYMMDD_a1b2c.json
  → R2 put → 写回 lastSuccessAt → list 删旧保 30
管理端（X-Token 鉴权）：
  GET  /api/backups            列出
  GET  /api/backups/:name      下载
  POST /api/backups/:name/restore   校验和 → 事务清表重灌
前端：设置页"备份"面板（状态行 + 保留份数 + 立即备份 + 列表）
保留的细节：文件名校验和前缀、恢复前 verify、失败状态写回供前端展示
```

### 2. R2 附件存储

#### NodeWarden 的做法

- **双后端抽象**：`src/services/blob-store.ts` 统一 put/get/delete，运行时探测绑定（R2 优先、KV 兜底，KV 单值 25MB 上限自动收紧 :32-44）；对象键是纯 ID 拼接（:46-48），元数据全在 D1
- **两步式上传 + 短时 JWT**（Workers 的 R2 binding 无法签 S3 预签名 URL，只能 Worker 中转）：① `POST /api/ciphers/{id}/attachment/v2`（`handlers/attachments.ts:165-237`）先落 D1 元数据、返回 5 分钟 JWT 上传 URL；② 带 token 的 `POST .../attachment/{aid}`（:265-301）验签后写 R2，`customMetadata` 记关联 ID
- **上传体解析**（`utils/direct-upload.ts:51-114`）：裸流强制 Content-Length 先比限额再收体；multipart 带 256KB 余量预检；限额集中 `config/limits.ts`（100MB）；返回 URL 伪造 Azure 风格 `sv=/se=` 参数纯为兼容官方客户端
- **下载鉴权**：一次性 JWT 下载链接，`jti` 经 D1 `INSERT ... ON CONFLICT DO NOTHING` 消费防重放（`storage-attachment-token-repo.ts:14-49`）；响应带 Content-Disposition/nosniff/类型白名单清洗
- 删除时 R2 与 D1 联动、并发批量删（:525-542）

#### 值不值得抄：**改造后抄**

两步 token 对图标上传杀鸡用牛刀（上传者就是已鉴权管理员）。**抄：Content-Length 预检 + 集中限额 + content-type 白名单 + customMetadata + 对象键不含用户输入 + 不可变键配 immutable 缓存**。

#### Phase 3 图标上传草图

```
POST /api/icons（鉴权，multipart: file + linkId）
  → Content-Length 预检（限额 1-2MB，limits.ts 集中）
  → 类型白名单 png/jpeg/svg/webp/x-icon
  → R2 put icons/{linkId}-{sha256前8位}.{ext}（服务端生成键）
  → links.iconSource='r2' + iconR2Key
GET /icon/{linkId}（公开）：R2 读 + Cache-Control immutable；external 的 302
换/删图标联动删旧对象
```

### 3. 鉴权与安全

#### NodeWarden 的做法

- **密钥模型**：客户端 600k 轮 PBKDF2 后服务端再叠 PBKDF2-SHA256(100k, email 盐)（`services/auth.ts:137-158`）——防"拖库即登录"；JWT(HS256 手写) 带 security_stamp；refresh token 是 D1 随机 opaque token，滑动+绝对双期限
- **登录防爆破**（`services/ratelimit.ts`）：登录失败计数走 **D1 UPSERT**（跨机房持久），10 次锁 2 分钟（:94-171）；普通 API 配额走 Cache API 固定窗口（零 D1 写，:176-208）；`getClientIdentifier`（:419-443）按 CF-Connecting-IP → X-Real-IP → XFF，**IPv6 折叠 /64** 防轮换绕过
- **JWT_SECRET 强度门禁**：短于 32 位全站 500 除白名单路径（`router.ts:9-26,161-164`）+ 前端警告页
- **安全响应头**：`applyCors`（`utils/response.ts:90-130`）统一注入 nosniff/Referrer-Policy/X-Frame-Options/CSP；CORS 仅同源/白名单带 credentials
- WebAuthn/2FA：完整 passkey + TOTP + YubiKey（`@simplewebauthn/server`）+ 4 个 connector 测试脚本

#### 值不值得抄

- **直接抄**：D1 UPSERT 登录锁定 + getClientIdentifier（IPv6 /64 折叠）——我们登录端点目前无防爆破，公网上最实际的洞；统一安全头中间件（Hono 一个 middleware）；限额收进 limits.ts
- **不适合**：双层 PBKDF2/JWT（我们 md5 token 是 PHP 插件兼容约束）；WebAuthn（无此威胁模型且包体显著增大）

### 4. D1 schema 与迁移

#### NodeWarden 的做法

- **运行时自举为主轨**：`services/storage-schema.ts:12-173` 幂等 DDL（CREATE TABLE IF NOT EXISTS + ALTER 捕获 duplicate column 吞掉）；首次请求 `initializeDatabase()`（`storage.ts:255-271`），`config` 表 `schema.version` 做门控（形如 `'2026-07-13-refresh-session-reuse'`）——版本变了才重跑全量 DDL；另有 REQUIRED_SCHEMA_TABLES 探测兜底
- `migrations/0001_init.sql` 只是镜像（文件头注释声明同步关系），wrangler.toml **没配 migrations_dir**——为"fork 一键部署零命令行"服务
- 非 STRICT 表；备份结构（backup-archive 的 BackupPayload）与 schema 手工同步靠契约注释

#### 值不值得抄：**抄"版本门控"思想，不抄双轨制**

NodeWarden 实为三源（运行时 DDL + 镜像 SQL + 备份契约）靠纪律硬扛。我们已有 schema-drift 测试兜底双源；补"options 表存 schema 版本 + 启动校验实际结构与期望一致，漂移时报错可读"即可。

### 5. 前端工程

#### NodeWarden 的做法

- 栈：**Preact**（非 React）+ wouter（1.7KB 路由）+ TanStack Query + Tailwind + 手写 CSS tokens；暗色主题纯 CSS 变量切换（`webapp/src/styles/dark.css`）——与我们主题 tokens 同思路
- **shared/ 双端共享**：仓库根 `shared/` 被 Worker 相对路径 import、被 webapp 以 vite alias `@shared` import——纯 TS 无构建产物
- **i18n**：10 语言，非英文 locale 动态 import 按语言分包（`vite.config.ts:301-308`）；`scripts/i18n-validate.cjs` 做 key/placeholder 对齐 + 疑似未翻译检测 + 白名单
- **PWA 无框架**：`vite.config.ts:9-237` 构建期插件手写生成 sw.js——cache version = 构建产物 URL 列表的 sha256（自动失效）、app-shell 回退、**API 路径永不缓存**；注册仅 18 行（`webapp/src/lib/pwa.ts`），dev 不注册失败静默
- **demo 模式**：`--mode demo` 下 alias 把 `@/lib/demo` 指向 1629 行 mock（正式构建指向空实现，编译期剔除）；配 Pages 部署 + `_redirects` 生成脚本做在线演示

#### 值不值得抄

- **直接抄**：PWA 构建期生成方案（Phase 4）——比 Workbox/vite-plugin-pwa 轻，两个缓存正确性坑已调好
- **改造后抄**：demo 模式 alias 替换（将来做主题在线预览的现成套路）；shared/ 共享层（我们暂无跨端共享类型需求，待有再立）
- **暂缓**：i18n 校验脚本（单语阶段）；Preact/wouter 不换

### 6. Workers 配置细节

- `run_worker_first = true` + `html_handling = "none"` + SPA fallback（`wrangler.toml:8-13`）：同域混 Bitwarden API（/api、/identity、WebSocket）与 SPA，Worker 必须先看请求分流；附带收益——能给静态响应加 X-Robots-Tag/CORS、`HIDE_WEB_VAULT=1` 一键藏前端保 API
- 双后端一份代码：`wrangler.kv.toml` 与主配置只差绑定块，代码运行时探测；`scripts/ensure-kv.cjs` 解决"KV namespace 要 account 级 id 不能写死"（列表找→没有就建→回写 toml）
- DO migrations tag：每个新 DO class 一个递增 tag（`v1-`、`v2-`），`new_sqlite_classes`（Cloudflare 已弃止 KV 后端 DO）；tag 发布后不可改只可追加

**对我们**：目前 assets-first 够用。记两笔：①将来要给静态响应统一加头/藏前端时，`run_worker_first + maybeServeAsset` 是唯一途径（会损失一点静态性能）；②Phase 4 点击统计若要强一致计数，DO + tag 是现成路径。

### 7. 运维/发布

- scripts/ 四类：部署辅助（ensure-kv、pages-spa-redirects）、数据同步（sync-global-domains 从上游拉等效域 + Actions 周度自动 PR）、契约测试（config-compatibility 等用 node:test，测"官方客户端兼容契约"而非实现细节）、安全自检（SSRF 用例矩阵跑一遍 dump JSON）
- CI：CodeQL（security-extended）+ Gitleaks 全史 + 周度上游同步，全部 pin action SHA
- **RELEASE_NOTES.md：63KB 单文件，顶部 15 行写作规则注释**（双语条目、每条带 commit 链接、只追加不删除）——把 release 纪律固化进文件
- README fork+connect 引导：Fork → Cloudflare 控制台连 GitHub → 两条命令，schema 自动初始化、JWT_SECRET 缺失自愈提示——为"零命令行用户"设计

**对我们**：改造后抄 RELEASE_NOTES 规则模板 + README 补 fork 部署段 + "契约型测试"思路（对 PHP 导入导出格式写兼容性测试，而非只测自身往返）。

---

## 三、明确不抄清单

WebAuthn/2FA、SignalR WebSocket 推送（NotificationsHub 925 行）、多用户邀请制、KV 双后端、备份目标凭据双信封加密、SSRF 防护矩阵（无用户可配 URL 的功能就不需要）、Preact 迁移——全部服务于密码管理器威胁模型或规模化部署，单用户书签站抄了只增复杂度。

---

## 四、关键源码索引（/Users/taowen/project/nodewarden/）

| 主题 | 文件 |
|---|---|
| 备份链路 | src/index.ts(scheduled) · src/durable/backup-transfer-runner.ts · src/handlers/backup.ts · src/services/backup-{archive,config,uploader,settings-crypto,import}.ts · shared/backup-schema.ts · src/router-admin-backup.ts |
| R2 附件 | src/handlers/attachments.ts · src/services/blob-store.ts · src/utils/{direct-upload,jwt}.ts |
| 安全 | src/services/{auth,ratelimit}.ts · src/utils/response.ts · src/router.ts · src/config/limits.ts |
| schema | src/services/{storage,storage-schema}.ts · migrations/0001_init.sql |
| 前端 | webapp/vite.config.ts(PWA 插件 :9-237) · webapp/src/lib/{i18n,pwa,demo}.ts · webapp/src/styles/dark.css |
| 运维 | scripts/* · RELEASE_NOTES.md · .github/workflows/* |
