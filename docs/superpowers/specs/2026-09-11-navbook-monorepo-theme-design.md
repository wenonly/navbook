# NavBook Monorepo 与主题分发架构设计

- **日期：** 2026-09-11
- **状态：** 设计定稿（六节全部经用户逐节确认）
- **前置：** OneNav Workers Phase 1-3 已上线（https://nav.wenonly.cn，105 测试，211 条书签已迁移）
- **品牌：** 全项目更名 onenav → **navbook**（wrangler name、版本串、文档措辞）；未来可能增加文章相关内容，架构为此留口

---

## 1. 目标与背景

把现有 `workers/`（内嵌 web + 主题）单仓库重构为 **pnpm workspace 多包并行结构**，主题升级为**独立完整前端应用**，为未来的主题下载分发（R2 上传/安装）铺路。

**本次范围**（结构+切换+minima）：
1. workspace 三包并行：`workers` / `web` / `themes/*` + `shared` 契约包
2. default2 迁移为独立应用；新写 minima 验证多主题并行
3. 主题动态路由伺服（run_worker_first + D1 配置，后台一键切换即生效）
4. public_nav 会话感知（公私数据分层，对齐 PHP OneNav 行为）
5. 品牌/结构/部署迁移（wrangler name=navbook、域名重绑）

**明确不在本次**：
- R2 主题上传/安装/卸载（分发功能闭环）——只定产物形状与 manifest 读取预留口
- admin client 迁入 shared（收敛项，记入后续）
- 文章功能（只保证结构不阻碍）
- Phase 4 原有内容（点击统计/URL 抓取/PWA）

---

## 2. 目标结构（根目录职责）

```
navbook/                          ← pnpm workspace 根
├── package.json                  # 编排脚本：dev / build / deploy / test 总入口
├── pnpm-workspace.yaml           # packages: [workers, web, themes/*, shared]
├── README.md                     # 项目说明 + 部署指南（fork / CLI 两种）
├── .gitignore                    # 根级（node_modules/ dist/ .wrangler/ 等）
├── scripts/aggregate.mjs         # 构建聚合：web + 各主题 dist → workers/dist
├── public/                       # 根级公共资产（favicon、robots.txt；aggregate 拷到 dist 根）
├── .github/workflows/            # CI（预留，本次空）
│
├── workers/                      ← 纯 API Worker（Hono + D1 + Drizzle）
│   ├── src/                      #   现有代码不动；router 重写伺服路由 + 主题配置端点
│   ├── tests/                    #   现有 105 测试（路径不变，断言按需更新）
│   ├── wrangler.toml             #   assets 三项改造 + name="navbook"
│   └── dist/                     #   聚合产物（gitignore）
│
├── web/                          ← 管理后台 SPA（从 workers/web 提升）
│   └── src/                      #   admin/login/init + 主题管理页；Home/ThemeRenderer/themes 退役
│
├── themes/
│   ├── default2/                 ← 独立前端项目（Vite8+React19+Tailwind3，官方模板栈）
│   │   ├── public/theme.json     #   清单（vite 自动拷进 dist）
│   │   ├── src/{main.tsx,App.tsx}
│   │   └── dist/                 #   独立产物 = 分发单元
│   └── minima/                   ← 第二主题（紧凑列表风，新写）
│
├── shared/                       ← @navbook/shared：类型 + API client（零框架依赖）
└── docs/
```

**包关系**：`themes/*` 与 `web` 依赖 `shared`（纯源码 workspace 依赖，Vite 直接吃 TS 源）；`workers` 不 import 任何前端包（按 URL 分流）。

**聚合产物布局**（`workers/dist/`）：

```
dist/
├── admin/                  ← web 构建（vite base: '/admin/'）
├── themes/
│   ├── manifest.json       ← aggregate 脚本扫描各主题 theme.json 生成
│   ├── default2/           ← 主题 dist 原样拷贝（vite base: '/themes/default2/'）
│   └── minima/
└── favicon.ico 等          ← 根级公共资产（源：仓库根 public/，web 原有的 favicon.svg 迁到此）
```

---

## 3. 主题契约（分发单元）

**产物目录即分发单元**，技术栈无关（React/Vue/Svelte/纯 HTML 皆可，只要长这个形状）：

```
themes/<id>/dist/
├── theme.json      # 清单
├── index.html      # 入口（服务端在 / 返回其内容）
└── assets/*        # 带 hash 的静态资源
```

`theme.json`：

```json
{
  "id": "default2",
  "name": "Default 2",
  "version": "1.0.0",
  "author": "taowen",
  "description": "卡片网格导航主题",
  "minAppVersion": "1.0.0"
}
```

（无 `api` 字段——主题通过 shared client 访问 **API 集合**，不硬编码端点。）

**契约规则**：
1. 主题自己经 shared client 获取数据并渲染整个页面；资源路径用 `/themes/<id>/` 前缀（vite base）
2. 主题不做鉴权 UI；登录页唯一由 web 壳提供（`/admin/login?redirect=`）
3. `private: true` 的分类/链接**必须视觉可区分**（锁标/角标，防管理员误判公开）
4. 面向主题的 `/api/*` 端点遵守**只加字段不删不改语义**的兼容承诺（老主题 + 新服务端可并存），由 shared 类型锁定

---

## 4. 数据与鉴权架构

**分层原则：身份随 cookie 透明流动，权限是服务端中间件的事，主题不碰凭据。**

```
传输层  cookie（HttpOnly 同源自动带）          ← 主题无感知
身份层  服务端三档中间件（公开/可选/强制）      ← 换档=服务端一行代码
渲染层  主题拿数据 + private 标记自行渲染      ← 只关心数据形状
```

**public_nav 改造**：挂 `optionalAuthMiddleware`——游客返回公开数据；管理员（cookie 自动携带）返回全量。NavData 契约增加标记：

```ts
interface NavCategory { /* ... */ private: boolean }
interface NavLink     { /* ... */ private: boolean }
```

**未来"主页端接口要鉴权"的三种形态全部有位**：

| 形态 | 例子 | 机制 |
|---|---|---|
| 数据视图分层 | 私有书签（现状）、文章公私 | 可选鉴权端点 + private 标记 |
| 读公开/写鉴权 | 主题配置（管理员改、游客读） | 读写拆端点各挂各档 |
| 强登录操作 | 收藏/评论/点击上报 | 强制鉴权 → 401 → 引导登录 |

**shared client 内置 401 语义**：`ApiError { status, code, msg }`；可选 `onUnauthorized` 回调，默认跳 `/admin/login?redirect=<当前路径>`。换强会话机制（多用户/opaque token）时主题零改动。

---

## 5. `@navbook/shared`

```ts
// 类型
export interface NavData / NavCategory / NavLink / SessionInfo { ... }   // 含 private
// API client（纯 fetch，同源零配置）
export function createApiClient(base = '') {
  return {
    publicNav: () => get<NavData>('/api/public_nav'),
    session:   () => get<SessionInfo>('/api/session'),
    // 未来在这里长：search(q) / articles() / themeConfig() ...
  };
}
// 错误
export class ApiError extends Error { status: number; code: number }
```

零构建：纯 TS 源被 web/themes 以 workspace 依赖直接 import。admin 的 FormData/写操作 client 本次**不迁**（后续收敛项）。

---

## 6. Worker 路由与主题配置 API

**wrangler 资产配置（Worker 主导）**：

```toml
[assets]
directory = "./dist"
binding = "ASSETS"
run_worker_first = true
html_handling = "none"
not_found_handling = "none"     # 回退显式写在路由
```

**路由表**：

| 请求 | 处理 |
|---|---|
| `/api/*` | API（public_nav 改可选鉴权） |
| `/themes/<id>/*` | `ASSETS.fetch(path)` 直出 |
| `/admin`、`/admin/*`、`/login`、`/init` | `ASSETS.fetch(path)`；404 回落 `/admin/index.html`（SPA 深链） |
| `/` | D1 `s_themes.active` → `/themes/<id>/index.html` 内容 |
| `/favicon.ico` 等根资产 | `ASSETS.fetch(path)` |
| 其余 | 302 → `/` |
| `/click/*` | Phase 4 预留位 |

**`/` 的降级链**：配置主题 → 产物缺失回落 `default2` → 兜底 302 `/admin`，每级 console.warn。

**manifest 来源（构建产物驱动 + R2 预留口）**：`aggregate.mjs` 生成 `dist/themes/manifest.json`；Worker 读取顺序 = **D1 覆盖段 → assets 段合并**（未来 R2 上传主题只写 D1，不动构建）。

**新增 API**：

```
GET  /api/themes     （authMiddleware）→ { code:0, data:{ active, themes:[...] } }   # manifest + D1
POST /api/set_theme  （authMiddleware，{theme:"minima"}）→ 校验在 manifest → upsert on_options.s_themes
```

主题切换即时生效（HTML 不缓存）。

---

## 7. 主题项目与开发体验

主题项目骨架（见 §2 结构）：`main.tsx` 引导（client 取数 → loading/error 重试/渲染）+ `App.tsx` 本体；`theme.json` 放 `public/` 随构建进 dist。

```bash
pnpm dev                                   # 根：wrangler(8787) + web(5173) 并行
pnpm --filter @navbook/theme-default2 dev  # 单主题热更：:5174/themes/default2/，API/cookie 走 proxy 打真实 D1
```

新建主题 = 复制目录改名（package.json / vite base / theme.json / App.tsx），不碰 web/workers。minima 为紧凑列表风第二主题，功能对齐 default2（两级分类、私标）。

---

## 8. 构建编排与部署迁移

**根脚本**：

| 命令 | 做什么 |
|---|---|
| `pnpm build` | 构建全部主题 + web → `node scripts/aggregate.mjs` 聚合 + 产物自检（缺 manifest/theme.json/admin index 即失败） |
| `pnpm dev` | wrangler + web 并行 |
| `pnpm test` | workers 测试 |
| `pnpm deploy` | `pnpm build` + `wrangler deploy` |

**品牌迁移三步**（一次性，进实施计划）：
1. `name="navbook"` 部署 → workers.dev 临时地址全链路验证
2. 解绑 `nav.wenonly.cn` 与旧 `onenav-workers`（删旧 Worker）
3. 再次 deploy 绑域名。D1 数据不动（同一 binding）。

---

## 9. 迁移映射

| 现有 | 去向 |
|---|---|
| `workers/pnpm-workspace.yaml` | 删；根新建 |
| `workers/package.json` | 瘦身为纯 API 包（deploy 编排迁根） |
| `workers/web/` | `git mv` → 根 `web/`；vite base `/admin/`、outDir 本包 dist |
| `web/src/themes/default2/` | 重生为 `themes/default2/src/`（独立应用） |
| `web/src/themes/loader.ts`、`components/ThemeRenderer.tsx`、`routes/Home.tsx`、`scripts/inline-tokens.ts`、index.html 占位脚本 | 退役删除（主题自带样式） |
| `web/src/types/nav.ts` | → `shared/src/types.ts`（+private） |
| `workers/src/router.ts` | 伺服路由重写 + 主题端点 + public_nav 改造 |
| `workers/wrangler.toml` | assets 三项 + name=navbook |

---

## 10. 测试策略

| 层 | 做法 |
|---|---|
| 后端 | 现有 105 个保留；新增：`/` 返回当前主题 HTML、set_theme 切换即生效、主题缺失回落链、set_theme 401；更新：public_nav（游客/管理员 + private）、SPA 深链回落 |
| 构建自检 | aggregate 末尾断言关键产物存在 |
| 主题 | 无单测；Playwright E2E：两主题渲染、后台切换、admin 全功能、公私可见性 |
| 契约 | shared 类型编译锁定；分发阶段再加 theme.json schema 测试 |

---

## 11. 风险

| 风险 | 缓解 |
|---|---|
| run_worker_first 后静态请求全过 Worker | 边缘内毫秒级，接受；监控 P99 |
| not_found_handling="none" 回退需显式 | 测试锁定每条回退路径 |
| 域名重绑秒级窗口 | 三步迁移法；低峰操作 |
| 生产数据 | D1 同 binding 不动；切换前 export_json 留一份 |
| 老 SPA `/` 直链书签 | `/` 语义不变（从主题渲染），无感 |

---

## 12. 后续（不在本次）

- R2 主题分发：上传 zip → 校验 theme.json → 注册 D1 manifest → 安装/卸载/在线预览
- admin client 收敛进 shared
- 文章内容模型（NavData 之外的文章 API 面向主题同一契约生长）
- 站点标题/副标题设置持久化（原 Phase 2 项，随主题配置页顺势做时可并入）
- Phase 4：点击统计 / get_link_info / PWA（NodeWarden 研究的构建期 sw 方案）
- NodeWarden 借鉴清单 #1/#2（R2 定时备份、登录防爆破）
