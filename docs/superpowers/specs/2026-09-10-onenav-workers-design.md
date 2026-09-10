# OneNav Workers 重构设计文档

- **日期：** 2026-09-10
- **目标：** 将 OneNav（PHP + SQLite 书签管理）重构为 Cloudflare Workers 全栈应用
- **范围：** 仅迁移浏览器插件所需的 API + 全新 React SPA 前端 + 主题系统

---

## 1. 背景与目标

OneNav 是一款浏览器书签管理器，原架构：

- 后端：PHP + Medoo ORM + SQLite（`class/Api.php` 提供 ~40 个公开方法）
- 前端：PHP 服务端渲染模板（`templates/default2`、`minima`、`admin` 等）
- 鉴权：`token = md5(USER + SecretKey)` 或 `X-Token` header 或 cookie
- 浏览器扩展通过 `POST /api/<method>` + `X-Token` 调用后端

**目标：**

1. 把浏览器插件所需的 API 迁移到 Cloudflare Workers + D1
2. 提供完整的 React SPA 前端（替换原 PHP 后台管理 + 主题首页）
3. 保持主题切换、分类 / 链接管理、token 鉴权能力
4. 支持从原 PHP 版本的 JSON 导出手动迁移数据

**明确不在本版范围：**

- 替换 OneNav 现有 PHP 版本（保留兼容）
- 服务端渲染（SSR）
- 多人多用户协作
- 在线升级检查 / 订阅密钥体系

---

## 2. 架构总览

### 2.1 运行时架构

```
浏览器扩展 (Chrome/Firefox)
        │
        │  POST /api/<method>  X-Token: md5(USER+SecretKey)
        ▼
┌─────────────────────────────────────────────────────┐
│          Cloudflare Worker (Hono router)            │
│  ┌──────────────┬──────────────┬─────────────────┐  │
│  │  /api/*      │  /click/:id  │  /* (SPA fallback)│ │
│  │  业务路由    │  跳转统计    │  index.html       │ │
│  └──────┬───────┴──────┬───────┴────────┬────────┘  │
└─────────┼──────────────┼────────────────┼───────────┘
          ▼              ▼                ▼
       D1 (Drizzle)   D1 (counters)   Static Assets (Vite build)
   ┌─────────────┐                  ┌──────────────────────┐
   │ on_categorys│                  │ React 18 + Vite SPA  │
   │ on_links    │                  │ Tailwind + HeadlessUI│
   │ on_options  │                  │ React Router         │
   │ on_shares   │                  │ Zustand (state)      │
   │ on_users    │                  │ TanStack Query       │
   │ on_clicks   │                  │                      │
   └─────────────┘                  └──────────────────────┘
```

### 2.2 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| Runtime | Cloudflare Workers | 用户指定 |
| Router | Hono v4 | Workers 生态最成熟，TS 优先，5KB |
| ORM | Drizzle ORM | Cloudflare 推荐，类型安全，cold-start 友好 |
| DB | Cloudflare D1 | SQLite 兼容，免费层 5GB 够用 |
| 前端构建 | Vite 8 | 用户指定 |
| UI | React 18 + Tailwind 3 | 主流方案 |
| 状态 | Zustand + TanStack Query | 轻量，避免 Redux 样板 |
| 表单 | React Hook Form + Zod | 类型校验 |
| 包管理 | pnpm | 速度快、磁盘省 |
| 测试 | Vitest + Miniflare | 单元测试 + D1 仿真 |
| 部署 | wrangler v3 + GitHub Actions | 单次 `wrangler deploy` |

---

## 3. 项目结构

```
navbook/
├── workers/                          # Cloudflare Worker 项目根
│   ├── src/
│   │   ├── index.ts                  # Worker 入口，挂载 Hono
│   │   ├── router.ts                 # API 路由聚合
│   │   ├── db/
│   │   │   ├── schema.ts             # Drizzle 表定义
│   │   │   ├── client.ts             # D1 绑定封装 (env.DB)
│   │   │   └── migrations/           # 0001_init.sql
│   │   ├── handlers/                 # 按业务域拆分
│   │   │   ├── auth.ts               # create_sk / check_login / app_info
│   │   │   ├── category.ts           # add/edit/del/list/get_a
│   │   │   ├── link.ts               # add/edit/del/list/q_category_link/get_a_link
│   │   │   ├── theme.ts              # get_themes / get_theme_config / save_theme_config
│   │   │   ├── click.ts              # /click/:id 跳转统计
│   │   │   ├── icon.ts               # /icon/:id 取站点图标
│   │   │   ├── search.ts             # get_link_info / 站内搜索
│   │   │   └── import-export.ts      # export_json / import_json
│   │   ├── middleware/
│   │   │   ├── cors.ts               # 跨域处理（兼容插件）
│   │   │   ├── auth.ts               # X-Token / cookie 鉴权
│   │   │   └── error.ts              # 统一错误响应
│   │   ├── lib/
│   │   │   ├── md5.ts                # Web Crypto 实现的 MD5
│   │   │   ├── html-meta.ts          # 抓取标题/描述（get_link_info）
│   │   │   ├── icon-source.ts        # 图标抽象层（Blob / R2 / external）
│   │   │   └── validate.ts           # Zod schemas
│   │   └── types.ts                  # Hono Env 类型
│   ├── web/                          # Vite 8 前端
│   │   ├── index.html                # SPA 入口（构建期注入 theme tokens）
│   │   ├── src/
│   │   │   ├── main.tsx              # React 挂载
│   │   │   ├── App.tsx               # 路由配置
│   │   │   ├── routes/
│   │   │   │   ├── Home.tsx
│   │   │   │   ├── Login.tsx
│   │   │   │   ├── Init.tsx          # 首登引导
│   │   │   │   ├── Admin/
│   │   │   │   │   ├── Categories.tsx
│   │   │   │   │   ├── Links.tsx
│   │   │   │   │   ├── Theme.tsx
│   │   │   │   │   ├── Settings.tsx
│   │   │   │   │   └── ImportExport.tsx
│   │   │   │   └── Share.tsx
│   │   │   ├── themes/               # 主题目录
│   │   │   │   ├── loader.ts         # 自动发现（import.meta.glob）
│   │   │   │   ├── default2/
│   │   │   │   │   ├── index.tsx
│   │   │   │   │   └── tokens.css
│   │   │   │   └── minima/
│   │   │   │       ├── index.tsx
│   │   │   │       └── tokens.css
│   │   │   ├── api/                  # 调用 /api/* 的 typed client
│   │   │   ├── hooks/
│   │   │   │   └── useTheme.ts
│   │   │   ├── stores/               # Zustand: auth, ui
│   │   │   ├── components/
│   │   │   │   ├── ThemeRenderer.tsx # 通用主题渲染器
│   │   │   │   ├── ThemeSwitcher.tsx
│   │   │   │   └── ...               # 通用组件
│   │   │   ├── types/
│   │   │   │   └── nav.ts            # NavData / NavCategory / NavLink
│   │   │   └── styles/
│   │   │       └── globals.css
│   │   ├── scripts/
│   │   │   └── inline-tokens.ts      # 构建期合并主题 tokens 到 index.html
│   │   ├── public/
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   ├── wrangler.toml
│   ├── package.json
│   └── tsconfig.json
└── docs/superpowers/specs/2026-09-10-onenav-workers-design.md
```

**关键决策：**

- 单仓单包：`workers/` 是仓库根，`web/` 是 Vite 子项目（Vite 8 默认支持 monorepo 工作区）
- 构建流水线：`pnpm --filter web build` → 产物落到 `workers/dist/` → `wrangler deploy` 读取 assets binding
- 无 Pages 子项目：所有静态资源走 Workers Static Assets

---

## 4. 数据库 Schema（Drizzle / D1）

```ts
// workers/src/db/schema.ts
import { sqliteTable, integer, text, blob, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('on_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  secretKey: text('secret_key'),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  usernameIdx: uniqueIndex('on_users_username_idx').on(t.username),
}));

export const categorys = sqliteTable('on_categorys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name', { length: 32 }).notNull(),
  addTime: integer('add_time').notNull(),
  upTime: integer('up_time'),
  weight: integer('weight').notNull().default(0),
  property: integer('property').notNull().default(0),
  description: text('description', { length: 128 }).default(''),
  fontIcon: text('font_icon', { length: 32 }),
  fid: integer('fid').notNull().default(0),
}, (t) => ({
  nameUnique: uniqueIndex('on_categorys_name_unique').on(t.name),
  fidIdx: index('on_categorys_fid_idx').on(t.fid),
}));

export const links = sqliteTable('on_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fid: integer('fid').notNull(),
  title: text('title', { length: 64 }).notNull(),
  url: text('url', { length: 256 }).notNull(),
  description: text('description', { length: 256 }),
  addTime: integer('add_time').notNull(),
  upTime: integer('up_time'),
  weight: integer('weight').notNull().default(0),
  property: integer('property').notNull().default(0),
  click: integer('click').notNull().default(0),
  topping: integer('topping').notNull().default(0),
  urlStandby: text('url_standby', { length: 256 }),
  fontIcon: text('font_icon', { length: 512 }),
  iconSource: text('icon_source', { length: 16 }).notNull().default('blob'), // inline|blob|r2|external
  iconBlob: blob('icon_blob', { mode: 'buffer' }),
  iconMime: text('icon_mime', { length: 32 }),
  checkStatus: integer('check_status').notNull().default(0),
  lastCheckedTime: integer('last_checked_time'),
}, (t) => ({
  urlUnique: uniqueIndex('on_links_url_unique').on(t.url),
  fidIdx: index('on_links_fid_idx').on(t.fid),
  weightIdx: index('on_links_weight_idx').on(t.weight),
}));

export const options = sqliteTable('on_options', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key', { length: 64 }).notNull(),
  value: text('value'),
  extend: text('extend'),
}, (t) => ({
  keyUnique: uniqueIndex('on_options_key_unique').on(t.key),
}));

export const shares = sqliteTable('on_shares', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sid: text('sid', { length: 8 }).notNull(),
  addTime: integer('add_time').notNull(),
  expireTime: integer('expire_time').notNull(),
  password: text('password', { length: 16 }),
  cid: integer('cid').notNull(),
  note: text('note', { length: 2048 }),
}, (t) => ({
  sidUnique: uniqueIndex('on_shares_sid_unique').on(t.sid),
}));

export const clicks = sqliteTable('on_clicks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  linkId: integer('link_id').notNull(),
  ip: text('ip', { length: 64 }),
  ua: text('ua', { length: 256 }),
  referer: text('referer', { length: 256 }),
  ts: integer('ts').notNull(),
}, (t) => ({
  linkIdIdx: index('on_clicks_link_id_idx').on(t.linkId),
  tsIdx: index('on_clicks_ts_idx').on(t.ts),
}));
```

**关键决策：**

1. **保留 PHP 版本的 `fid` 二级分类**：字段名、长度、默认值与原 SQLite 完全一致
2. **`on_users` 取代 `USER/ENCRYPTED_PASSWORD` 常量**：`secret_key` 单独存以生成插件 token
3. **`on_clicks` 拆出**：原版 `click` 计数器内嵌 `on_links`，现拆出明细表支持 `/click/:id` 统计
4. **图标二进制存 `on_links.icon_blob` + `iconSource` 标记**：≤200 KB；通过 `/api/icon/:id` 输出 MIME
5. **R2 扩展预留**：`iconSource` 字段标记来源，新增 `R2IconStore` 实现 `IconStore` 接口即可切换
6. **全部 STRICT 表 + 显式类型**：避免 D1 类型推断陷阱
7. **索引策略**：WHERE/ORDER BY 用到的 `url`、`fid`、`weight`、`key`、`username` 上加索引

---

## 5. 图标存储抽象（R2 扩展预留）

```ts
// workers/src/lib/icon-source.ts
export type IconSource =
  | { kind: 'inline'; dataUri: string }
  | { kind: 'blob'; linkId: number }
  | { kind: 'r2'; key: string }
  | { kind: 'external'; url: string };

export interface IconStore {
  get(source: IconSource): Promise<Response>;
  put(linkId: number, bytes: Uint8Array, mime: string): Promise<IconSource>;
  delete(source: IconSource): Promise<void>;
}

// 当前实现
export class BlobIconStore implements IconStore {
  constructor(private db: D1Database) {}
  // 读 on_links.icon_blob
}

// 未来实现（预留接口）
// export class R2IconStore implements IconStore {
//   constructor(private bucket: R2Bucket) {}
// }

export function getIconStore(env: Env): IconStore {
  return env.R2 ? new R2IconStore(env.R2) : new BlobIconStore(env.DB);
}
```

迁移路径：用户上传图标 → 写入 `icon_blob` + `iconSource='blob'`；后续脚本批量推到 R2。

---

## 6. API 端点（仅插件所需）

| Method | Path | PHP 原方法 | 鉴权 | 说明 |
|---|---|---|---|---|
| POST | `/api/check_login` | `check_login` | 无 | token 校验 |
| POST | `/api/app_info` | `app_info` | 无 | 应用元信息 |
| POST | `/api/init` | `controller/init.php` | 无（仅首用户） | 首登引导 |
| POST | `/api/login` | `controller/login.php` | 无 | 登录，成功由服务端 Set-Cookie（HttpOnly） |
| GET | `/api/session` | — | 可选 | 探测当前登录态（SPA 恢复会话用） |
| GET | `/api/public_nav` | — | 无 | 公开导航数据（两级分类 + 公开链接，SPA 首页用） |
| POST | `/api/create_sk` | `create_sk` | 必须 | 生成 SecretKey |
| POST | `/api/category_list` | `category_list` | 可选 | 分页查分类；游客只见公开分类（对齐 PHP 行为） |
| POST | `/api/add_category` | `add_category` | 必须 | 新增分类 |
| POST | `/api/edit_category` | `edit_category` | 必须 | 修改分类 |
| POST | `/api/del_category` | `del_category` | 必须 | 删除分类 |
| POST | `/api/get_a_category` | `get_a_category` | 可选 | 取单个分类 |
| POST | `/api/link_list` | `link_list` | 可选 | 分页查链接；游客只见公开分类下的公开链接 |
| POST | `/api/add_link` | `add_link` | 必须 | 新增链接 |
| POST | `/api/edit_link` | `edit_link` | 必须 | 修改链接 |
| POST | `/api/del_link` | `del_link` | 必须 | 删除链接 |
| POST | `/api/q_category_link` | `q_category_link` | 可选 | 按分类查链接 |
| POST | `/api/get_a_link` | `get_a_link` | 可选 | 取单个链接（私有数据游客拒绝） |
| POST | `/api/get_link_info` | `get_link_info` | 必须 | 抓取 URL 标题/描述 |
| GET | `/click/:id` | `click.php` | 无 | 点击统计 + 302 跳转（顶级路径，便于扩展插件中转） |
| GET | `/api/icon/:id` | `ico.php` | 无 | 输出图标 |
| POST | `/api/import_json` | `import_link` | 必须 | 导入 JSON |
| POST | `/api/export_json` | `export_json` | 必须 | 导出 JSON |
| GET | `/api/manifest.json` | — | 无 | PWA manifest |

鉴权三档：**无**（公开）、**可选**（optionalAuth：游客降级为只见公开数据，对齐 PHP 插件兼容行为）、**必须**（401）。

`/api/*` 未知方法返回 JSON `{ code: -404, msg: 'method not found!' }`（不落入 SPA fallback）。

**未迁移的端点**（PHP 后台专用）：订阅检查、在线升级、SQL 升级、备份/恢复、订阅密钥验证、第三方主题下载。新 Workers 版 admin SPA 直接操作上述核心端点，绕过这些。

**响应格式（与 PHP 版兼容）：**

```json
{ "code": 0, "id": 42 }
{ "code": 0, "data": {...}, "msg": "successful" }
{ "code": 0, "msg": "", "count": 123, "data": [...] }
{ "code": -1002, "msg": "Authorization failure!" }
```

**鉴权兼容策略：**

```
请求到达 → cors 中间件 → auth 中间件
                              ↓
            ┌─────────────────┴─────────────────┐
            │ X-Token header 存在？             │
            │  ├─ 是：md5 比对，命中通过        │
            │  └─ 否：查 cookie，命中通过       │
            └───────────────────────────────────┘
```

**CORS 配置：**

```ts
cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Token', 'Authorization', 'X-Cid'],
  exposeHeaders: ['X-Token'],
  maxAge: 86400,
})
```

**输入校验：** 每个 handler 用 Zod schema 校验 body，错误码与 PHP 版对齐。

---

## 7. 认证流程

**密码兼容：**

```ts
function verifyPassword(plain: string, stored: string): boolean {
  if (stored === plain) return true;       // 明文（旧版）
  return md5(plain) === stored;             // md5
}
```

**SecretKey 生成（`/api/create_sk`）：**

```ts
const sk = crypto.randomUUID().replace(/-/g, '');
await db.update(users).set({ secretKey: sk }).where(eq(users.id, currentUserId));
return { code: 0, data: { secret_key: sk } };
```

**Token 计算（插件侧不变）：**

```
X-Token = md5(USER + SecretKey)
```

**Worker 侧验证：**

```ts
const username = c.env.USERNAME;
const secretKey = (await getOption(c.env.DB, 'SecretKey'))?.value;
const tokenYes = md5(username + (secretKey ?? ''));

if (xtoken === tokenYes) return next();
if (cookie === md5(username + passwordHash + 'onenav' + ua)) return next();
return c.json({ code: -1002 }, 401);
```

**首登引导：** `on_users` 为空时进入 `/init` 设置首用户 + 生成 SecretKey。

**Cookie 设置：**

```ts
setCookie(c, 'key', md5(USER + passwordHash + 'onenav' + ua), {
  httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 2592000
});
```

**wrangler.toml 配置：**

```toml
[vars]
USERNAME = "admin"   # 仅作 fallback；实际从 on_users 读
```

SecretKey 通过 `/api/create_sk` 生成后存 D1，**不在 wrangler.toml 里**。

---

## 8. 主题系统

### 8.1 设计原则

1. 每个主题 = 一个目录，两个文件（`index.tsx` + `tokens.css`）
2. 主题系统全局仅一份配置：`loader.ts`（自动发现）
3. 自动发现，零注册表
4. tokens CSS 全量内联到 `index.html`（~5 KB 总计，零 FOUC）
5. 主题组件代码分割（首屏只加载当前激活主题）

### 8.2 目录结构

```
web/src/themes/
├── loader.ts                          # 唯一配置文件（15 行）
├── default2/
│   ├── index.tsx
│   └── tokens.css
└── minima/
    ├── index.tsx
    └── tokens.css
```

### 8.3 loader.ts（自动发现）

```ts
const components = import.meta.glob<{ default: React.ComponentType<any> }>('./*/index.tsx');
const tokens     = import.meta.glob<string>('./*/tokens.css', { query: '?raw', import: 'default' });

export const themeIds = Object.keys(components)
  .map(p => p.replace(/^\.\//, '').replace(/\/index\.tsx$/, ''));

export async function loadTheme(id: string) {
  const [compMod, tokensStr] = await Promise.all([
    components[`./${id}/index.tsx`](),
    tokens[`./${id}/tokens.css`](),
  ]);
  return { Component: compMod.default, tokens: tokensStr };
}

export const displayName = (id: string) =>
  id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
```

### 8.4 主题组件契约

```tsx
// web/src/types/nav.ts
export interface NavLink {
  id: number;
  fid: number;
  title: string;
  url: string;
  description: string | null;
  font_icon: string | null;
  url_standby: string | null;
}
export interface NavCategory {
  id: number;
  name: string;
  font_icon: string | null;
  description: string | null;
  children: NavCategory[];   // 二级分类
  links: NavLink[];          // 直挂本分类的公开链接
}
export interface NavData {
  site_title: string;
  site_subtitle: string;
  categories: NavCategory[];
}
```

```tsx
// web/src/themes/default2/index.tsx
import type { NavData } from '@/types/nav';

export default function Default2({ data }: { data: NavData }) {
  return <main className="theme-default2">{/* 主题自由发挥 */}</main>;
}
```

### 8.5 tokens.css 内联到 index.html

```html
<head>
  <style id="theme-tokens">
    /* 构建脚本扫描 themes/*/tokens.css 合并注入 */
  </style>
  <script>
    try {
      var t = localStorage.getItem('onenav.theme') || 'default2';
      document.documentElement.dataset.theme = t;
    } catch(e) {}
  </script>
</head>
```

构建脚本（`web/scripts/inline-tokens.ts`）：

```ts
import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'tinyglobby';

const merged = globSync('src/themes/*/tokens.css')
  .map(f => `/* ${f} */\n${readFileSync(f, 'utf8').trim()}`)
  .join('\n\n');

const html = readFileSync('index.html', 'utf8')
  .replace(/<style id="theme-tokens">[\s\S]*?<\/style>/,
    `<style id="theme-tokens">\n${merged}\n</style>`);
writeFileSync('index.html', html);
```

### 8.6 ThemeRenderer

```tsx
// web/src/components/ThemeRenderer.tsx
export function ThemeRenderer({ themeId, data }: { themeId: string; data: NavData }) {
  const [Component, setComponent] = useState<ComponentType<{ data: NavData }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTheme(themeId).then(t => {
      if (!cancelled) {
        setComponent(() => t.Component);
        document.documentElement.dataset.theme = themeId;
        localStorage.setItem('onenav.theme', themeId);
      }
    });
    return () => { cancelled = true; };
  }, [themeId]);

  if (!Component) return null;  // tokens 已就绪 → 不闪
  return <Component data={data} />;
}
```

### 8.7 首屏时序

```
0ms    HTML 到达
       ├─ <style id="theme-tokens"> 已含全部主题变量
       └─ <script> 同步设 data-theme
0ms    React 入口异步加载
200ms  React 挂载 → useTheme 触发 → loadTheme('default2')
       └─ 此时 tokens 在，组件 JS 到达后直接渲染，无样式闪烁
350ms  主题组件 chunk 到达 → 渲染完整首页
```

### 8.8 新增主题步骤

```bash
mkdir web/src/themes/my-new-theme
# 写两个文件：index.tsx + tokens.css
# pnpm build（prebuild 自动合并 tokens，loader 自动发现）
```

零配置改动。

---

## 9. 数据迁移（JSON 导出 / 导入）

**导出格式：**

```json
{
  "categories": [{ "id": 1, "name": "工具", "fid": 0, ... }],
  "links": [{ "id": 1, "fid": 2, "title": "GitHub", ... }]
}
```

**导入逻辑：**

1. 解析 JSON
2. 分类映射：旧 ID → 新 ID，按 fid=0 先建顶级，再建二级
3. 链接批量插入，fid 用新映射替换
4. `db.batch([...])` 包成事务
5. URL 唯一约束去重（重复跳过不报错）

**前端：** 后台「导入导出」页面，下载 / 上传 JSON。

---

## 10. 部署与运维

### 10.1 wrangler.toml

```toml
name = "onenav-workers"
compatibility_date = "2025-05-01"

[[d1_databases]]
binding = "DB"
database_name = "onenav-db"
database_id = "<from wrangler d1 create>"

[assets]
directory = "./dist"
binding = "ASSETS"

[build]
command = "pnpm --filter web build && pnpm --filter web inline-tokens"
```

### 10.2 首次部署

```bash
pnpm install
pnpm --filter web build        # 触发 prebuild inline tokens
wrangler d1 create onenav-db   # 输出 database_id
pnpm wrangler d1 execute onenav-db --file=workers/src/db/migrations/0001_init.sql
wrangler deploy
```

### 10.3 CI/CD

GitHub Actions 在 `main` 分支推送时自动构建并部署，凭据使用 `CLOUDFLARE_API_TOKEN` secret。

### 10.4 监控

- Cloudflare Dashboard → Workers Analytics（请求量、错误率、P99）
- D1 Metrics（读 / 写行数、慢查询）
- 免费层配额：Workers 100k 请求/日、D1 5M 读/日 + 5GB 存储

### 10.5 回滚

```bash
wrangler rollback
wrangler deployments list
```

---

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| D1 冷启动延迟 | 使用 Drizzle 预处理语句；批量操作用 `db.batch()` |
| 单次查询 100 参数上限 | 列表分页限制 ≤50 |
| 图标二进制膨胀 | 单图 ≤200 KB；R2 接口预留 |
| 主题切换 FOUC | tokens 内联到 `<head>`；预加载脚本同步设 `data-theme` |
| Workers bundle 体积 | Vite 代码分割；主题组件按需懒加载 |
| 数据迁移丢失 | 提供 dry-run 模式；幂等导入；URL 唯一约束去重 |
| 旧插件不兼容 | 鉴权、响应格式、CORS header 全部与 PHP 版一致 |

---

## 12. 后续扩展（不在本版）

- R2 图标存储迁移（接口已预留）
- SSR（@cloudflare/vite-plugin）
- 多用户协作 / JWT
- AI 检索增强
- 主题市场（用户上传 / 下载主题包）

---

## 13. 实施优先级

1. **阶段 1（MVP）：** Worker 骨架 + D1 schema + 鉴权 + category/link CRUD + React SPA 框架 + 一套主题（default2）
2. **阶段 2：** 主题切换、主题切换器 UI、minima 主题
3. **阶段 3：** 数据迁移（导出 / 导入 JSON）、图标上传
4. **阶段 4：** 链接信息抓取、点击统计、PWA manifest

每个阶段独立可交付、可回滚。

**本设计文档涵盖全部 4 个阶段；`writing-plans` 阶段会先把阶段 1 拆解为可执行的实施计划，后续阶段按需追加。**
