# OneNav Workers Phase 1 (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 OneNav 浏览器插件所需的最小 API（鉴权 + 分类 / 链接 CRUD + 公开导航数据）迁移到 Cloudflare Workers，并用 React SPA 替换原 PHP 前端，运行一套 default2 主题。

**Architecture:** 单 Worker（方案 A）：Hono 路由 `/api/*` 走 D1（Drizzle）；其余路径走 Workers Static Assets（Vite 8 构建产物，SPA fallback 由 `not_found_handling = "single-page-application"` 支持）。主题目录 `themes/<id>/{index.tsx, tokens.css}`，loader 自动发现；tokens 构建期内联到 `index.html`，组件按需懒加载。

**Tech Stack:** Cloudflare Workers · Hono v4 · Drizzle ORM · D1 · Vite 8 · React 18 · TanStack Query · Tailwind 3 · Zod · js-md5

**Spec:** `docs/superpowers/specs/2026-09-10-onenav-workers-design.md`

**测试基建:** `@cloudflare/vitest-pool-workers`（官方 workers 池，通过 `cloudflare:test` 模块访问 `env.DB`，setup 阶段用 `applyD1Migrations` 建表）。**不要**使用 `environment: 'miniflare'` —— Vitest 没有这个 environment。

---

## File Structure (新增)

```
navbook/workers/
├── .gitignore                              # node_modules / dist / .wrangler
├── package.json                            # 根 package.json（pnpm workspace）
├── pnpm-workspace.yaml
├── wrangler.toml
├── tsconfig.json
├── vitest.config.ts                        # vitest-pool-workers 配置
├── src/
│   ├── index.ts                            # Worker 入口
│   ├── router.ts                           # API 路由聚合 + SPA fallback
│   ├── types.ts                            # Hono Env 类型
│   ├── db/
│   │   ├── schema.ts                       # Drizzle 表定义（6 张表）
│   │   ├── client.ts                       # D1 绑定封装
│   │   └── migrations/
│   │       └── 0000_init.sql               # 初始 schema（6 表 + 8 索引）
│   ├── middleware/
│   │   ├── cors.ts
│   │   ├── auth.ts                         # authenticate + authMiddleware + optionalAuthMiddleware
│   │   └── error.ts
│   ├── lib/
│   │   ├── md5.ts                          # js-md5 封装（同步）
│   │   ├── escape.ts                       # escapeHtml（对齐 PHP htmlspecialchars）
│   │   └── validate.ts                     # Zod schemas
│   └── handlers/
│       ├── auth.ts                         # check_login / create_sk / app_info
│       ├── init.ts                         # init / login（服务端 Set-Cookie 在 router 层）
│       ├── category.ts
│       ├── link.ts
│       └── public.ts                       # public_nav / session
├── web/                                    # Vite 8 SPA
│   ├── index.html                          # 含 <style id="theme-tokens"> 占位 + 预设 data-theme 脚本
│   ├── package.json
│   ├── vite.config.ts                      # @ alias → ./src，proxy /api /click → 8787
│   ├── tsconfig.json                       # paths: @/* → ./src/*
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── scripts/
│   │   └── inline-tokens.ts                # 构建期合并主题 tokens 到 index.html
│   ├── public/
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── types/
│       │   └── nav.ts                      # NavData（两级分类 + links）
│       ├── api/
│       │   ├── client.ts                   # cookie 鉴权（同源自动携带），无需手动传 token
│       │   └── hooks.ts
│       ├── stores/
│       │   └── auth.ts                     # 只存 username（cookie 为 HttpOnly 不可读）
│       ├── components/
│       │   └── ThemeRenderer.tsx
│       ├── routes/
│       │   ├── Home.tsx                    # 数据来自 GET /api/public_nav
│       │   ├── Login.tsx
│       │   ├── Init.tsx
│       │   └── Admin/
│       │       ├── Layout.tsx              # 挂载时 ping /api/session 恢复登录态
│       │       ├── Categories.tsx
│       │       └── Links.tsx
│       └── themes/
│           ├── loader.ts
│           └── default2/
│               ├── index.tsx
│               └── tokens.css
└── tests/
    ├── setup.ts                            # applyD1Migrations
    ├── helpers.ts                          # resetTables / seedUser / validToken / validCookie
    ├── lib/
    │   └── md5.test.ts
    ├── middleware/
    │   └── auth.test.ts
    └── handlers/
        ├── category.test.ts
        └── link.test.ts
```

---

## Task 1: 初始化 pnpm workspace + Worker 骨架

**Files:**
- Create: `workers/.gitignore`
- Create: `workers/package.json`
- Create: `workers/pnpm-workspace.yaml`
- Create: `workers/src/index.ts`（脚手架生成或手写）
- Create: `workers/wrangler.toml`
- Create: `workers/tsconfig.json`

- [ ] **Step 1: 创建 workers 目录并写 .gitignore（必须在安装依赖前，否则 node_modules 会进 git）**

```bash
mkdir -p /Users/taowen/project/navbook/workers
```

创建 `workers/.gitignore`：

```
node_modules/
dist/
.wrangler/
.dev.vars
*.log
```

- [ ] **Step 2: 用官方 create-cloudflare 脚手架初始化（优先脚手架，避免手写幻觉配置）**

```bash
cd /Users/taowen/project/navbook/workers
pnpm create cloudflare@latest . -- --framework=hono --no-git --no-deploy
```

交互提示时：目录用当前目录 `.`，其余默认。
若 `--framework=hono` 参数不被识别，改跑 `pnpm create cloudflare@latest .` 进入交互模式，框架类型手动选 **"Framework Starter → Hono"**。

**兜底方案**（脚手架彻底失败时手写最小骨架）：

`workers/package.json`：

```json
{
  "name": "onenav-workers",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "pnpm --filter web build && wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate:local": "wrangler d1 migrations apply onenav-db --local",
    "db:migrate:remote": "wrangler d1 migrations apply onenav-db --remote"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "drizzle-orm": "^0.36.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^1.0.0",
    "@cloudflare/workers-types": "^4.20250901.0",
    "js-md5": "^0.8.3",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^4.0.0",
    "zod": "^3.23.0"
  }
}
```

（正常路径下脚手架会生成 package.json，之后按上面补充 scripts 和依赖即可。）

`workers/src/index.ts`（兜底手写版）：

```ts
import { Hono } from 'hono';

const app = new Hono();
app.get('/', c => c.json({ hello: 'onenav-workers' }));

export default app;
```

`workers/wrangler.toml`（兜底手写版，后续 Task 2 会完善）：

```toml
name = "onenav-workers"
main = "src/index.ts"
compatibility_date = "2025-05-01"
compatibility_flags = ["nodejs_compat"]
```

- [ ] **Step 3: 补齐 workspace 配置**

`workers/package.json` 的 `name` 必须是 `onenav-workers`，并确保 scripts 区块与 Step 2 兜底版一致（`dev` / `deploy` / `test` / `db:migrate:*`）。

创建 `workers/pnpm-workspace.yaml`：

```yaml
packages:
  - .
  - web
```

- [ ] **Step 4: 安装依赖**

```bash
cd /Users/taowen/project/navbook/workers
pnpm add hono drizzle-orm js-md5 zod
pnpm add -D wrangler typescript vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types
```

- [ ] **Step 5: 验证 wrangler dev 启动**

```bash
cd /Users/taowen/project/navbook/workers
(pnpm dev > /tmp/onenav-dev.log 2>&1 &)
sleep 8
curl -s http://localhost:8787/ && echo
# 用完杀掉：pkill -f "wrangler dev" || true
```

Expected: 返回 `{"hello":"onenav-workers"}`（或脚手架模板的等价 JSON）。

- [ ] **Step 6: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/.gitignore workers/package.json workers/pnpm-workspace.yaml workers/wrangler.toml workers/tsconfig.json workers/src workers/pnpm-lock.yaml
git commit -m "chore: scaffold Worker (Hono) with pnpm workspace"
```

（`.gitignore` 已确保 node_modules 不会进 git；若 `git status` 显示 node_modules，说明 Step 1 失败，停下排查。）

---

## Task 2: wrangler.toml — D1 绑定 + vars + migrations_dir

**Files:**
- Modify: `workers/wrangler.toml`

- [ ] **Step 1: 写完整 wrangler.toml**

本地开发阶段用占位 UUID 作 `database_id`（miniflare 本地模拟不校验真实性，真实 ID 在 Task 19 创建远程库时替换）：

```toml
name = "onenav-workers"
main = "src/index.ts"
compatibility_date = "2025-05-01"
compatibility_flags = ["nodejs_compat"]

[vars]
USERNAME = "admin"

[[d1_databases]]
binding = "DB"
database_name = "onenav-db"
database_id = "00000000-0000-4000-8000-000000000000"
migrations_dir = "src/db/migrations"
```

说明：
- `nodejs_compat` 是 `@cloudflare/vitest-pool-workers` 的硬性要求
- `migrations_dir` 让测试 setup 与 `wrangler d1 migrations apply` 共享同一份迁移
- `USERNAME` 是 token 计算的 fallback（真实用户存 on_users 表）

- [ ] **Step 2: 临时探针验证 D1 绑定**

临时修改 `workers/src/index.ts`：

```ts
import { Hono } from 'hono';

const app = new Hono();
app.get('/', c => c.json({ hello: 'onenav-workers', hasDb: !!c.env.DB }));

export default app;
```

（若 `c.env.DB` 报 TS 错误，临时用 `(c.env as any).DB`，Task 3 建立正式类型后移除。）

```bash
cd /Users/taowen/project/navbook/workers
(pnpm dev > /tmp/onenav-dev.log 2>&1 &)
sleep 8
curl -s http://localhost:8787/ && echo
pkill -f "wrangler dev" || true
```

Expected: `{"hello":"onenav-workers","hasDb":true}`。

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/wrangler.toml workers/src/index.ts
git commit -m "chore: bind D1 database and vars in wrangler.toml"
```

---

## Task 3: Drizzle Schema（6 张表）+ 初始 migration + client

**Files:**
- Create: `workers/src/db/schema.ts`
- Create: `workers/src/db/migrations/0000_init.sql`
- Create: `workers/src/db/client.ts`

- [ ] **Step 1: 写 Drizzle schema**

创建 `workers/src/db/schema.ts`。注意 `users.username` 用列级 `.unique()`，**不要**再加显式 uniqueIndex（避免重复建索引）：

```ts
import { sqliteTable, integer, text, blob, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('on_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  secretKey: text('secret_key'),
  createdAt: integer('created_at').notNull(),
});

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
  iconSource: text('icon_source', { length: 16 }).notNull().default('blob'),
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

- [ ] **Step 2: 写 migration SQL（6 表 + 8 索引 = 14 条语句）**

创建 `workers/src/db/migrations/0000_init.sql`（文件名必须以 `0000_` 开头，这是 wrangler d1 migrations 的命名约定）：

```sql
-- OneNav Workers initial schema
CREATE TABLE on_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  secret_key TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE on_categorys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  add_time INTEGER NOT NULL,
  up_time INTEGER,
  weight INTEGER NOT NULL DEFAULT 0,
  property INTEGER NOT NULL DEFAULT 0,
  description TEXT DEFAULT '',
  font_icon TEXT,
  fid INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX on_categorys_name_unique ON on_categorys(name);
CREATE INDEX on_categorys_fid_idx ON on_categorys(fid);

CREATE TABLE on_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fid INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  add_time INTEGER NOT NULL,
  up_time INTEGER,
  weight INTEGER NOT NULL DEFAULT 0,
  property INTEGER NOT NULL DEFAULT 0,
  click INTEGER NOT NULL DEFAULT 0,
  topping INTEGER NOT NULL DEFAULT 0,
  url_standby TEXT,
  font_icon TEXT,
  icon_source TEXT NOT NULL DEFAULT 'blob',
  icon_blob BLOB,
  icon_mime TEXT,
  check_status INTEGER NOT NULL DEFAULT 0,
  last_checked_time INTEGER
);
CREATE UNIQUE INDEX on_links_url_unique ON on_links(url);
CREATE INDEX on_links_fid_idx ON on_links(fid);
CREATE INDEX on_links_weight_idx ON on_links(weight);

CREATE TABLE on_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value TEXT,
  extend TEXT
);
CREATE UNIQUE INDEX on_options_key_unique ON on_options(key);

CREATE TABLE on_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid TEXT NOT NULL,
  add_time INTEGER NOT NULL,
  expire_time INTEGER NOT NULL,
  password TEXT,
  cid INTEGER NOT NULL,
  note TEXT
);
CREATE UNIQUE INDEX on_shares_sid_unique ON on_shares(sid);

CREATE TABLE on_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL,
  ip TEXT,
  ua TEXT,
  referer TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX on_clicks_link_id_idx ON on_clicks(link_id);
CREATE INDEX on_clicks_ts_idx ON on_clicks(ts);
```

- [ ] **Step 3: 本地应用 migration**

```bash
cd /Users/taowen/project/navbook/workers
pnpm db:migrate:local
```

Expected: 输出 `🚣 Executed 1 command`（1 个 migration 文件，内含 14 条语句）成功，无报错。

- [ ] **Step 4: 写 Drizzle client**

创建 `workers/src/db/client.ts`：

```ts
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb(d1: D1Database): DrizzleD1Database<typeof schema> {
  return drizzle(d1, { schema });
}

export type DB = DrizzleD1Database<typeof schema>;
```

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/src/db workers/package.json workers/pnpm-lock.yaml
git commit -m "feat(db): Drizzle schema (6 tables) and initial migration"
```

---

## Task 4: 测试基建（vitest-pool-workers）+ MD5（js-md5）

**Files:**
- Create: `workers/vitest.config.ts`
- Create: `workers/tests/setup.ts`
- Create: `workers/tests/helpers.ts`
- Create: `workers/src/lib/md5.ts`
- Create: `workers/tests/lib/md5.test.ts`

- [ ] **Step 1: 写 vitest.config.ts（官方 workers 池，不是 miniflare environment）**

创建 `workers/vitest.config.ts`：

```ts
import { defineWorkersConfig, D1_MIGRATIONS } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    poolOptions: {
      workers: {
        singleWorker: true,
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: D1_MIGRATIONS },
        },
      },
    },
  },
});
```

说明：`D1_MIGRATIONS` 从 wrangler.toml 的 `migrations_dir` 读取迁移文件，注入为 `TEST_MIGRATIONS` 绑定，供 setup 应用。

- [ ] **Step 2: 写 setup.ts（应用 D1 migration）**

创建 `workers/tests/setup.ts`：

```ts
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

（幂等：已应用的 migration 不会重复执行。）

- [ ] **Step 3: 写测试 helpers**

创建 `workers/tests/helpers.ts`：

```ts
import { env } from 'cloudflare:test';

export async function resetTables() {
  await env.DB.exec(
    'DELETE FROM on_clicks; DELETE FROM on_shares; DELETE FROM on_links; ' +
    'DELETE FROM on_categorys; DELETE FROM on_options; DELETE FROM on_users;'
  );
}

/** 预置单用户 admin / 密码 test123（md5 存储）/ SecretKey=sk_test */
export async function seedUser() {
  const { md5 } = await import('../src/lib/md5');
  await env.DB.exec(
    `INSERT INTO on_users (username, password_hash, created_at) VALUES ('admin', '${md5('test123')}', 1710000000);`
  );
  await env.DB.exec(
    `INSERT INTO on_options (key, value) VALUES ('SecretKey', 'sk_test');`
  );
}

/** 合法插件 token = md5(username + SecretKey) */
export function validToken(md5fn: (s: string) => string) {
  return md5fn('admin' + 'sk_test');
}

/** 合法登录 cookie = md5(username + passwordHash + 'onenav' + ua) */
export function validCookie(md5fn: (s: string) => string, ua: string) {
  return md5fn('admin' + md5fn('test123') + 'onenav' + ua);
}
```

- [ ] **Step 4: 写失败的 MD5 测试（RFC 1321 已知向量）**

创建 `workers/tests/lib/md5.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { md5 } from '../../src/lib/md5';

describe('md5（RFC 1321 向量，与 PHP md5() 输出一致）', () => {
  it('空字符串', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });
  it('"a"', () => {
    expect(md5('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
  });
  it('"abc"', () => {
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
  it('"message digest"', () => {
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
  });
  it('同步 API（无 await）', () => {
    expect(typeof md5('x')).toBe('string');
  });
});
```

- [ ] **Step 5: 跑测试确认失败**

```bash
cd /Users/taowen/project/navbook/workers && pnpm test
```

Expected: FAIL —— `Cannot find module '../../src/lib/md5'`（或等价的模块缺失错误）。

- [ ] **Step 6: 用 js-md5 实现封装（同步）**

创建 `workers/src/lib/md5.ts`。**不手写 MD5 算法**，直接封装 `js-md5`（3KB、纯 JS、workerd 兼容、自带 TS 类型）：

```ts
import { md5 as jsMd5 } from 'js-md5';

/**
 * 同步 MD5，输出 32 位小写 hex，与 PHP md5() 完全一致。
 * 用于 token（md5(USER + SecretKey)）和 cookie 校验。
 */
export function md5(input: string): string {
  return jsMd5(input);
}
```

（若 TS 报 js-md5 类型缺失：`pnpm add -D @types/js-md5`。）

- [ ] **Step 7: 跑测试确认通过**

```bash
cd /Users/taowen/project/navbook/workers && pnpm test
```

Expected: 5 个 md5 测试全部 PASS。

- [ ] **Step 8: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/vitest.config.ts workers/tests workers/src/lib/md5.ts
git commit -m "test: vitest-pool-workers setup + md5 wrapper with RFC 1321 vectors"
```

---

## Task 5: Zod schemas + escapeHtml

**Files:**
- Create: `workers/src/lib/validate.ts`
- Create: `workers/src/lib/escape.ts`

- [ ] **Step 1: 写 escapeHtml（对齐 PHP htmlspecialchars ENT_QUOTES）**

创建 `workers/src/lib/escape.ts`：

```ts
/** 等价 PHP htmlspecialchars($s, ENT_QUOTES)，入库前对用户输入统一转义 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

- [ ] **Step 2: 写共享 Zod schemas**

创建 `workers/src/lib/validate.ts`：

```ts
import { z } from 'zod';

export const addCategorySchema = z.object({
  token: z.string().optional(),
  name: z.string().min(1).max(32),
  property: z.coerce.number().int().min(0).max(1).optional().default(0),
  weight: z.coerce.number().int().min(0).optional().default(0),
  description: z.string().max(128).optional().default(''),
  font_icon: z.string().max(32).optional().default(''),
  fid: z.coerce.number().int().min(0).optional().default(0),
});

export const editCategorySchema = addCategorySchema.extend({
  id: z.coerce.number().int().positive(),
});

export const delCategorySchema = z.object({
  token: z.string().optional(),
  id: z.coerce.number().int().positive(),
});

export const getACategorySchema = z.object({
  token: z.string().optional(),
  id: z.coerce.number().int().positive(),
});

export const addLinkSchema = z.object({
  token: z.string().optional(),
  fid: z.coerce.number().int().positive(),
  title: z.string().min(1).max(64),
  url: z.string().url().max(256),
  description: z.string().max(256).optional().default(''),
  weight: z.coerce.number().int().min(0).optional().default(0),
  property: z.coerce.number().int().min(0).max(1).optional().default(0),
  url_standby: z.string().max(256).optional().default(''),
  font_icon: z.string().max(512).optional().default(''),
});

export const editLinkSchema = addLinkSchema.extend({
  id: z.coerce.number().int().positive(),
});

export const delLinkSchema = z.object({
  token: z.string().optional(),
  id: z.coerce.number().int().positive(),
});

export const getALinkSchema = z.object({
  token: z.string().optional(),
  id: z.coerce.number().int().positive(),
});

export const qCategoryLinkSchema = z.object({
  token: z.string().optional(),
  category_id: z.coerce.number().int().positive(),
});

export const initSchema = z.object({
  username: z.string().min(1).max(32),
  password: z.string().min(6).max(64),
});

export const loginSchema = z.object({
  password: z.string().min(1).max(64),
});
```

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/src/lib
git commit -m "feat(lib): Zod schemas + escapeHtml for input validation"
```

---

## Task 6: Hono Env 类型 + 错误中间件

**Files:**
- Create: `workers/src/types.ts`
- Create: `workers/src/middleware/error.ts`

- [ ] **Step 1: 写 Hono Env 类型**

创建 `workers/src/types.ts`：

```ts
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from './db/schema';

export type AppEnv = {
  Bindings: {
    DB: D1Database;
    USERNAME: string;
    ASSETS: Fetcher;
  };
  Variables: {
    db: DrizzleD1Database<typeof schema>;
    isAuthed: boolean;
    username: string | null;
  };
};
```

- [ ] **Step 2: 写错误中间件（handler 只返回纯对象，Response 包装收口在 router 层）**

创建 `workers/src/middleware/error.ts`：

```ts
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

export const errorMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  try {
    await next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal Server Error';
    console.error('Unhandled error:', err);
    // 业务错误（handler 主动 throw 的 Error）返回 200 + 错误码，与 PHP 版行为一致
    return c.json({ code: -2000, msg });
  }
};
```

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/src/types.ts workers/src/middleware/error.ts
git commit -m "feat(middleware): Hono env types and unified error handler"
```

---

## Task 7: CORS 中间件

**Files:**
- Create: `workers/src/middleware/cors.ts`

- [ ] **Step 1: 写 CORS 中间件（与 PHP 版 header 一致）**

创建 `workers/src/middleware/cors.ts`：

```ts
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

export const corsMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Token, Authorization, X-Cid',
        'Access-Control-Expose-Headers': 'X-Token',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-Token, Authorization, X-Cid');
  c.header('Access-Control-Expose-Headers', 'X-Token');
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/src/middleware/cors.ts
git commit -m "feat(middleware): CORS handler compatible with browser extension"
```

---

## Task 8: 鉴权（authenticate + 强制/可选中间件）

**Files:**
- Create: `workers/src/middleware/auth.ts`
- Create: `workers/tests/middleware/auth.test.ts`

设计说明：
- `authenticate()` 是核心：返回 `username | null`，供强制鉴权、可选鉴权、`/api/session` 三处复用
- `authMiddleware`：失败返回 401（写操作用）
- `optionalAuthMiddleware`：失败不拒绝，只把 `isAuthed` 置 false（列表查询用，游客可见公开数据，对齐 PHP 行为）

- [ ] **Step 1: 写失败的测试**

创建 `workers/tests/middleware/auth.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { env } from 'cloudflare:test';
import { authMiddleware, authenticate } from '../../src/middleware/auth';
import { getDb } from '../../src/db/client';
import { md5 } from '../../src/lib/md5';
import { resetTables, seedUser } from '../helpers';

beforeEach(async () => {
  await resetTables();
  await seedUser();
});

function makeApp() {
  const app = new Hono();
  // 模拟 router 里的 db 注入中间件
  app.use('*', async (c, next) => {
    c.set('db', getDb(env.DB));
    c.set('isAuthed', false);
    c.set('username', null);
    await next();
  });
  app.use('/protected/*', authMiddleware);
  app.get('/protected/ping', c => c.json({ ok: true }));
  return app;
}

describe('authenticate', () => {
  it('合法 X-Token 返回 username', async () => {
    const name = await authenticate(getDb(env.DB), 'admin', md5('adminsk_test'), undefined, 'ua');
    expect(name).toBe('admin');
  });

  it('合法 cookie（含 UA）返回 username', async () => {
    const ua = 'vitest-ua';
    const cookie = md5('admin' + md5('test123') + 'onenav' + ua);
    const name = await authenticate(getDb(env.DB), 'admin', undefined, cookie, ua);
    expect(name).toBe('admin');
  });

  it('UA 不匹配时 cookie 失败', async () => {
    const cookie = md5('admin' + md5('test123') + 'onenav' + 'other-ua');
    const name = await authenticate(getDb(env.DB), 'admin', undefined, cookie, 'vitest-ua');
    expect(name).toBeNull();
  });

  it('无凭据返回 null', async () => {
    const name = await authenticate(getDb(env.DB), 'admin', undefined, undefined, 'ua');
    expect(name).toBeNull();
  });
});

describe('authMiddleware', () => {
  it('合法 X-Token 放行', async () => {
    const res = await makeApp().request('/protected/ping', {
      headers: { 'X-Token': md5('adminsk_test') },
    });
    expect(res.status).toBe(200);
  });

  it('无凭据返回 401 + code -1002', async () => {
    const res = await makeApp().request('/protected/ping');
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe(-1002);
  });

  it('非法 X-Token 且无 cookie 返回 401', async () => {
    const res = await makeApp().request('/protected/ping', {
      headers: { 'X-Token': 'bad' },
    });
    expect(res.status).toBe(401);
  });

  it('非法 X-Token 但合法 cookie 放行（回落逻辑）', async () => {
    const ua = 'vitest-ua';
    const cookie = md5('admin' + md5('test123') + 'onenav' + ua);
    const res = await makeApp().request('/protected/ping', {
      headers: { 'X-Token': 'bad', 'User-Agent': ua, Cookie: `key=${cookie}` },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/taowen/project/navbook/workers && pnpm test
```

Expected: FAIL —— `Cannot find module '../../src/middleware/auth'`。

- [ ] **Step 3: 实现 authenticate + 两个中间件**

创建 `workers/src/middleware/auth.ts`：

```ts
import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';
import { md5 } from '../lib/md5';
import { eq } from 'drizzle-orm';
import { users, options } from '../db/schema';
import type { DB } from '../db/client';

/**
 * 统一鉴权：X-Token = md5(username + SecretKey) 或 cookie key = md5(username + passwordHash + 'onenav' + UA)
 * 成功返回 username，失败返回 null。
 */
export async function authenticate(
  db: DB,
  fallbackUsername: string,
  xtoken: string | undefined,
  cookieKey: string | undefined,
  ua: string,
): Promise<string | null> {
  const userRow = await db.select().from(users).limit(1).get();
  if (!userRow) return null;
  const username = userRow.username || fallbackUsername;

  // X-Token 校验（需要已生成 SecretKey）
  if (xtoken) {
    const skRow = await db.select().from(options).where(eq(options.key, 'SecretKey')).get();
    if (skRow?.value && xtoken === md5(username + skRow.value)) {
      return username;
    }
  }

  // cookie 校验（绑定 UA，与 PHP is_login() 一致）
  if (cookieKey && cookieKey === md5(username + userRow.passwordHash + 'onenav' + ua)) {
    return username;
  }

  return null;
}

/** 强制鉴权：写操作用，失败 401 */
export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const username = await authenticate(
    c.get('db'),
    c.env.USERNAME,
    c.req.header('X-Token'),
    getCookie(c, 'key'),
    c.req.header('User-Agent') ?? '',
  );
  if (!username) {
    return c.json({ code: -1002, msg: 'Authorization failure!' }, 401);
  }
  c.set('isAuthed', true);
  c.set('username', username);
  await next();
};

/** 可选鉴权：列表查询用，游客只看公开数据（对齐 PHP link_list 游客分支） */
export const optionalAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const username = await authenticate(
    c.get('db'),
    c.env.USERNAME,
    c.req.header('X-Token'),
    getCookie(c, 'key'),
    c.req.header('User-Agent') ?? '',
  );
  c.set('isAuthed', username !== null);
  c.set('username', username);
  await next();
};
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/taowen/project/navbook/workers && pnpm test
```

Expected: 8 个 auth 测试（authenticate 4 + middleware 4）全部 PASS。

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/src/middleware/auth.ts workers/tests/middleware/auth.test.ts
git commit -m "feat(middleware): authenticate + required/optional auth middlewares"
```

---

## Task 9: Category handlers（TDD）

**Files:**
- Create: `workers/src/handlers/category.ts`
- Create: `workers/tests/handlers/category.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `workers/tests/handlers/category.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import {
  addCategoryHandler, editCategoryHandler, delCategoryHandler,
  categoryListHandler, getACategoryHandler,
} from '../../src/handlers/category';
import { resetTables } from '../helpers';

beforeEach(async () => {
  await resetTables();
});

const db = () => getDb(env.DB);

describe('add_category', () => {
  it('新增成功返回 id', async () => {
    const res = await addCategoryHandler(db(), {
      name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0,
    });
    expect(res.code).toBe(0);
    expect(res.id).toBeGreaterThan(0);
  });

  it('空名称抛出中文错误', async () => {
    await expect(addCategoryHandler(db(), {
      name: '', property: 0, weight: 0, description: '', font_icon: '', fid: 0,
    })).rejects.toThrow('分类名称不能为空');
  });

  it('重名抛出 Categorie already exist!（PHP 原文，含拼写）', async () => {
    const input = { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 };
    await addCategoryHandler(db(), input);
    await expect(addCategoryHandler(db(), input)).rejects.toThrow('Categorie already exist!');
  });

  it('HTML 注入被转义', async () => {
    await addCategoryHandler(db(), {
      name: '<script>x</script>', property: 0, weight: 0, description: '', font_icon: '', fid: 0,
    });
    const row = await db().select().from((await import('../../src/db/schema')).categorys).get();
    expect(row!.name).toBe('&lt;script&gt;x&lt;/script&gt;');
  });
});

describe('edit_category', () => {
  it('二级分类的父分类校验', async () => {
    const top = await addCategoryHandler(db(), { name: '一级', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    const sub = await addCategoryHandler(db(), { name: '二级', property: 0, weight: 0, description: '', font_icon: '', fid: top.id });
    // 把新分类挂到二级分类下 → 拒绝
    await expect(editCategoryHandler(db(), 999, {
      name: 'x', property: 0, weight: 0, description: '', font_icon: '', fid: sub.id,
    })).rejects.toThrow('父级ID不存在');
  });

  it('有子分类时不能改为二级', async () => {
    const top = await addCategoryHandler(db(), { name: '一级', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    await addCategoryHandler(db(), { name: '二级', property: 0, weight: 0, description: '', font_icon: '', fid: top.id });
    await expect(editCategoryHandler(db(), top.id, {
      name: '一级', property: 0, weight: 0, description: '', font_icon: '', fid: 12345,
    })).rejects.toThrow('子分类');
  });
});

describe('del_category', () => {
  it('有子分类时拒绝删除', async () => {
    const top = await addCategoryHandler(db(), { name: '一级', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    await addCategoryHandler(db(), { name: '二级', property: 0, weight: 0, description: '', font_icon: '', fid: top.id });
    await expect(delCategoryHandler(db(), top.id)).rejects.toThrow('子分类');
  });

  it('有链接时拒绝删除', async () => {
    const { addLinkHandler } = await import('../../src/handlers/link');
    const cat = await addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    await addLinkHandler(db(), {
      fid: cat.id, title: 'GitHub', url: 'https://github.com',
      description: '', weight: 0, property: 0, url_standby: '', font_icon: '',
    });
    await expect(delCategoryHandler(db(), cat.id)).rejects.toThrow('存在链接');
  });

  it('空分类删除成功', async () => {
    const cat = await addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    const res = await delCategoryHandler(db(), cat.id);
    expect(res.code).toBe(0);
  });
});

describe('category_list', () => {
  it('游客只见公开分类，登录后见全部', async () => {
    await addCategoryHandler(db(), { name: '公开', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    await addCategoryHandler(db(), { name: '私有', property: 1, weight: 0, description: '', font_icon: '', fid: 0 });

    const guest = await categoryListHandler(db(), 1, 10, false);
    expect(guest.count).toBe(1);
    expect(guest.data[0].name).toBe('公开');

    const admin = await categoryListHandler(db(), 1, 10, true);
    expect(admin.count).toBe(2);
  });
});

describe('get_a_category', () => {
  it('按 ID 返回分类', async () => {
    const cat = await addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    const res = await getACategoryHandler(db(), cat.id);
    expect(res.code).toBe(0);
    expect(res.data.name).toBe('工具');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/taowen/project/navbook/workers && pnpm test
```

Expected: FAIL —— `Cannot find module '../../src/handlers/category'`。

- [ ] **Step 3: 实现 category handlers**

创建 `workers/src/handlers/category.ts`：

```ts
import { eq, sql, desc, and } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { escapeHtml } from '../lib/escape';

export interface CategoryInput {
  name: string;
  property: number;
  weight: number;
  description: string;
  font_icon: string;
  fid: number;
}

export interface CategoryRow {
  id: number; name: string; addTime: number; upTime: number | null;
  weight: number; property: number; description: string | null;
  fontIcon: string | null; fid: number;
}

export async function addCategoryHandler(db: DB, input: CategoryInput): Promise<{ code: 0; id: number }> {
  if (!input.name.trim()) throw new Error('分类名称不能为空！');
  try {
    await db.insert(schema.categorys).values({
      name: escapeHtml(input.name),
      addTime: Math.floor(Date.now() / 1000),
      weight: input.weight,
      property: input.property,
      description: escapeHtml(input.description),
      fontIcon: input.font_icon || null,
      fid: input.fid,
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      throw new Error('Categorie already exist!');  // PHP 原始文案（含拼写），保持兼容
    }
    throw e;
  }
  const row = await db.select({ id: schema.categorys.id }).from(schema.categorys)
    .where(eq(schema.categorys.name, escapeHtml(input.name))).get();
  return { code: 0, id: row!.id };
}

export async function editCategoryHandler(db: DB, id: number, input: CategoryInput): Promise<{ code: 0; msg: string }> {
  if (!input.name.trim()) throw new Error('The category name cannot be empty!');

  if (input.fid !== 0) {
    const parent = await db.select().from(schema.categorys).where(eq(schema.categorys.id, input.fid)).get();
    if (!parent) throw new Error('父级ID不存在！');
    if (parent.fid !== 0) throw new Error('父分类不能是二级分类!');
  }

  const childCount = await db.select({ c: sql<number>`count(*)` }).from(schema.categorys)
    .where(eq(schema.categorys.fid, id)).get();
  if ((childCount?.c ?? 0) > 0 && input.fid !== 0) {
    throw new Error('修改失败，该分类下已存在子分类！');
  }

  await db.update(schema.categorys).set({
    name: escapeHtml(input.name),
    upTime: Math.floor(Date.now() / 1000),
    weight: input.weight,
    property: input.property,
    description: escapeHtml(input.description),
    fontIcon: input.font_icon || null,
    fid: input.fid,
  }).where(eq(schema.categorys.id, id));
  return { code: 0, msg: 'successful' };
}

export async function delCategoryHandler(db: DB, id: number): Promise<{ code: 0; msg: string }> {
  const cat = await db.select().from(schema.categorys).where(eq(schema.categorys.id, id)).get();
  if (!cat) throw new Error('The category does not exist!');

  const subCount = await db.select({ c: sql<number>`count(*)` }).from(schema.categorys)
    .where(eq(schema.categorys.fid, id)).get();
  if ((subCount?.c ?? 0) > 0) throw new Error('请先删除下面的子分类！');

  const linkCount = await db.select({ c: sql<number>`count(*)` }).from(schema.links)
    .where(eq(schema.links.fid, id)).get();
  if ((linkCount?.c ?? 0) > 0) throw new Error('此分类下存在链接，不允许删除！');

  await db.delete(schema.categorys).where(eq(schema.categorys.id, id));
  return { code: 0, msg: 'successful' };
}

export async function categoryListHandler(
  db: DB, page: number, limit: number, isAuthed: boolean,
): Promise<{ code: 0; msg: ''; count: number; data: CategoryRow[] }> {
  const offset = (page - 1) * limit;
  const where = isAuthed ? undefined : eq(schema.categorys.property, 0);
  const countRow = await db.select({ c: sql<number>`count(*)` }).from(schema.categorys)
    .where(where).get();
  const rows = await db.select().from(schema.categorys)
    .where(where)
    .orderBy(desc(schema.categorys.weight), desc(schema.categorys.id))
    .limit(limit).offset(offset).all();
  return { code: 0, msg: '', count: countRow?.c ?? 0, data: rows as CategoryRow[] };
}

export async function getACategoryHandler(db: DB, id: number): Promise<{ code: number; data: CategoryRow | null; msg?: string }> {
  const row = await db.select().from(schema.categorys).where(eq(schema.categorys.id, id)).get();
  if (!row) return { code: -2000, msg: 'The category does not exist!', data: null };
  return { code: 0, data: row as CategoryRow };
}
```

（`addCategoryHandler` 依赖 link handler 尚未存在的测试只有 `del_category` 的"有链接"分支 —— 该测试在 Task 10 实现后才能通过，本 task 先允许它 FAIL，Task 10 完成后一起验证。）

- [ ] **Step 4: 跑测试，除 link 依赖项外全部通过**

```bash
cd /Users/taowen/project/navbook/workers && pnpm test
```

Expected: 除 `del_category > 有链接时拒绝删除`（依赖 Task 10）外全部 PASS。

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/src/handlers/category.ts workers/tests/handlers/category.test.ts
git commit -m "feat(handlers): category CRUD with validation (TDD)"
```

---

## Task 10: Link handlers + public_nav（TDD）

**Files:**
- Create: `workers/src/handlers/link.ts`
- Create: `workers/src/handlers/public.ts`
- Create: `workers/tests/handlers/link.test.ts`
- Create: `workers/tests/handlers/public.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `workers/tests/handlers/link.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { addCategoryHandler } from '../../src/handlers/category';
import {
  addLinkHandler, editLinkHandler, delLinkHandler,
  linkListHandler, qCategoryLinkHandler, getALinkHandler,
} from '../../src/handlers/link';
import { resetTables } from '../helpers';

beforeEach(async () => {
  await resetTables();
});

const db = () => getDb(env.DB);

async function seedCat() {
  return addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
}

const linkInput = (fid: number) => ({
  fid, title: 'GitHub', url: 'https://github.com',
  description: '', weight: 0, property: 0, url_standby: '', font_icon: '',
});

describe('add_link', () => {
  it('新增成功返回 id', async () => {
    const cat = await seedCat();
    const res = await addLinkHandler(db(), linkInput(cat.id));
    expect(res.code).toBe(0);
    expect(res.id).toBeGreaterThan(0);
  });

  it('fid 不存在时报错', async () => {
    await expect(addLinkHandler(db(), linkInput(999))).rejects.toThrow('分类ID不存在');
  });

  it('URL 重复抛 The URL already exists!', async () => {
    const cat = await seedCat();
    await addLinkHandler(db(), linkInput(cat.id));
    await expect(addLinkHandler(db(), linkInput(cat.id))).rejects.toThrow('The URL already exists!');
  });
});

describe('edit_link / del_link', () => {
  it('修改后 title 更新', async () => {
    const cat = await seedCat();
    const added = await addLinkHandler(db(), linkInput(cat.id));
    await editLinkHandler(db(), added.id, { ...linkInput(cat.id), title: 'GitHub 2' });
    const got = await getALinkHandler(db(), added.id, true);
    expect(got.data!.title).toBe('GitHub 2');
  });

  it('删除后查不到', async () => {
    const cat = await seedCat();
    const added = await addLinkHandler(db(), linkInput(cat.id));
    await delLinkHandler(db(), added.id);
    const got = await getALinkHandler(db(), added.id, true);
    expect(got.code).toBe(-2000);
  });
});

describe('link_list / q_category_link（游客可见性）', () => {
  it('游客只见公开分类下的公开链接', async () => {
    const pubCat = await seedCat();
    const privCat = await addCategoryHandler(db(), { name: '私有分类', property: 1, weight: 0, description: '', font_icon: '', fid: 0 });
    await addLinkHandler(db(), { ...linkInput(pubCat.id), url: 'https://a.com' });
    await addLinkHandler(db(), { ...linkInput(privCat.id), url: 'https://b.com' });

    const guest = await linkListHandler(db(), 1, 10, false);
    expect(guest.count).toBe(1);
    expect(guest.data[0].url).toBe('https://a.com');

    const admin = await linkListHandler(db(), 1, 10, true);
    expect(admin.count).toBe(2);
  });

  it('q_category_link 按分类过滤并带 categoryName', async () => {
    const cat = await seedCat();
    await addLinkHandler(db(), { ...linkInput(cat.id), url: 'https://a.com' });
    const res = await qCategoryLinkHandler(db(), cat.id, 1, 10, true);
    expect(res.count).toBe(1);
    expect(res.data[0].categoryName).toBe('工具');
  });
});
```

创建 `workers/tests/handlers/public.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { addCategoryHandler } from '../../src/handlers/category';
import { addLinkHandler } from '../../src/handlers/link';
import { publicNavHandler } from '../../src/handlers/public';
import { resetTables } from '../helpers';

beforeEach(async () => {
  await resetTables();
});

const db = () => getDb(env.DB);

describe('public_nav', () => {
  it('返回两级分类 + 公开链接，私有数据被过滤', async () => {
    const top = await addCategoryHandler(db(), { name: '一级', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    const sub = await addCategoryHandler(db(), { name: '二级', property: 0, weight: 0, description: '', font_icon: '', fid: top.id });
    const priv = await addCategoryHandler(db(), { name: '私有', property: 1, weight: 0, description: '', font_icon: '', fid: 0 });

    await addLinkHandler(db(), { fid: sub.id, title: 'SubLink', url: 'https://sub.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
    await addLinkHandler(db(), { fid: top.id, title: 'TopLink', url: 'https://top.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
    await addLinkHandler(db(), { fid: priv.id, title: 'PrivLink', url: 'https://priv.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });

    const res = await publicNavHandler(db());
    expect(res.code).toBe(0);
    expect(res.data.site_title).toBe('OneNav');
    expect(res.data.categories.length).toBe(1);            // 只有公开的"一级"
    const topCat = res.data.categories[0];
    expect(topCat.name).toBe('一级');
    expect(topCat.links.map((l: any) => l.title)).toContain('TopLink');
    expect(topCat.children.length).toBe(1);
    expect(topCat.children[0].links[0].title).toBe('SubLink');
  });

  it('空库返回空数组', async () => {
    const res = await publicNavHandler(db());
    expect(res.code).toBe(0);
    expect(res.data.categories).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/taowen/project/navbook/workers && pnpm test
```

Expected: FAIL —— link / public 模块不存在；同时 Task 9 遗留的 `有链接时拒绝删除` 应转为 PASS（link handler 可用后）。

- [ ] **Step 3: 实现 link handlers**

创建 `workers/src/handlers/link.ts`：

```ts
import { eq, sql, desc, and, inArray } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { escapeHtml } from '../lib/escape';

export interface LinkInput {
  fid: number;
  title: string;
  url: string;
  description: string;
  weight: number;
  property: number;
  url_standby: string;
  font_icon: string;
}

export interface LinkRow {
  id: number; fid: number; title: string; url: string;
  description: string | null; addTime: number; upTime: number | null;
  weight: number; property: number; click: number; topping: number;
  urlStandby: string | null; fontIcon: string | null;
  categoryName?: string;
}

/** 游客可见 = 链接公开 且 所属分类公开 */
function guestLinkWhere(db: DB) {
  const publicCatIds = db
    .select({ id: schema.categorys.id })
    .from(schema.categorys)
    .where(eq(schema.categorys.property, 0));
  return and(eq(schema.links.property, 0), inArray(schema.links.fid, publicCatIds));
}

export async function addLinkHandler(db: DB, input: LinkInput): Promise<{ code: 0; id: number }> {
  const cat = await db.select().from(schema.categorys).where(eq(schema.categorys.id, input.fid)).get();
  if (!cat) throw new Error('分类ID不存在！');

  try {
    await db.insert(schema.links).values({
      fid: input.fid,
      title: escapeHtml(input.title),
      url: input.url,
      urlStandby: input.url_standby || null,
      description: escapeHtml(input.description),
      addTime: Math.floor(Date.now() / 1000),
      weight: input.weight,
      property: input.property,
      ...(input.font_icon ? { fontIcon: input.font_icon } : {}),
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      throw new Error('The URL already exists!');
    }
    throw e;
  }
  const row = await db.select({ id: schema.links.id }).from(schema.links)
    .where(eq(schema.links.url, input.url)).get();
  return { code: 0, id: row!.id };
}

export async function editLinkHandler(db: DB, id: number, input: LinkInput): Promise<{ code: 0; msg: string }> {
  const cat = await db.select().from(schema.categorys).where(eq(schema.categorys.id, input.fid)).get();
  if (!cat) throw new Error('分类ID不存在！');
  await db.update(schema.links).set({
    fid: input.fid,
    title: escapeHtml(input.title),
    url: input.url,
    urlStandby: input.url_standby || null,
    description: escapeHtml(input.description),
    upTime: Math.floor(Date.now() / 1000),
    weight: input.weight,
    property: input.property,
    fontIcon: input.font_icon || null,
  }).where(eq(schema.links.id, id));
  return { code: 0, msg: 'successful' };
}

export async function delLinkHandler(db: DB, id: number): Promise<{ code: 0; msg: string }> {
  await db.delete(schema.links).where(eq(schema.links.id, id));
  return { code: 0, msg: 'successful' };
}

export async function linkListHandler(
  db: DB, page: number, limit: number, isAuthed: boolean, categoryId?: number,
): Promise<{ code: 0; msg: ''; count: number; data: LinkRow[] }> {
  const offset = (page - 1) * limit;
  const conds = [];
  if (!isAuthed) conds.push(guestLinkWhere(db));
  if (categoryId) conds.push(eq(schema.links.fid, categoryId));
  const where = conds.length ? and(...conds) : undefined;

  const countRow = await db.select({ c: sql<number>`count(*)` }).from(schema.links).where(where).get();
  const rows = await db.select({
    id: schema.links.id, fid: schema.links.fid, title: schema.links.title,
    url: schema.links.url, description: schema.links.description,
    addTime: schema.links.addTime, upTime: schema.links.upTime,
    weight: schema.links.weight, property: schema.links.property,
    click: schema.links.click, topping: schema.links.topping,
    urlStandby: schema.links.urlStandby, fontIcon: schema.links.fontIcon,
    categoryName: sql<string>`(SELECT name FROM on_categorys WHERE id = ${schema.links.fid})`,
  }).from(schema.links)
    .where(where)
    .orderBy(desc(schema.links.weight), desc(schema.links.id))
    .limit(limit).offset(offset).all();

  return { code: 0, msg: '', count: countRow?.c ?? 0, data: rows as LinkRow[] };
}

export async function qCategoryLinkHandler(
  db: DB, fid: number, page: number, limit: number, isAuthed: boolean,
): Promise<{ code: number; msg: string; count: number; data: LinkRow[] }> {
  if (!fid) return { code: -2000, msg: '分类ID不能为空！', count: 0, data: [] };
  // q_category_link 复用 link_list 的分类过滤 + 游客过滤
  return linkListHandler(db, page, limit, isAuthed, fid);
}

export async function getALinkHandler(
  db: DB, id: number, isAuthed: boolean,
): Promise<{ code: number; data: LinkRow | null; msg?: string }> {
  const row = await db.select().from(schema.links).where(eq(schema.links.id, id)).get();
  if (!row) return { code: -2000, msg: 'Link not found', data: null };
  if (!isAuthed) {
    if (row.property === 1) return { code: -1002, msg: 'Authorization failure!', data: null };
    const cat = await db.select().from(schema.categorys).where(eq(schema.categorys.id, row.fid)).get();
    if (cat?.property === 1) return { code: -1002, msg: 'Authorization failure!', data: null };
  }
  return { code: 0, data: row as LinkRow };
}
```

- [ ] **Step 4: 实现 public_nav**

创建 `workers/src/handlers/public.ts`：

```ts
import { eq, desc, and, inArray } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';

export interface PublicNavLink {
  id: number; fid: number; title: string; url: string;
  description: string | null; font_icon: string | null; url_standby: string | null;
}
export interface PublicNavCategory {
  id: number; name: string; font_icon: string | null; description: string | null;
  children: PublicNavCategory[];
  links: PublicNavLink[];
}
export interface PublicNavResult {
  code: 0;
  data: {
    site_title: string;
    site_subtitle: string;
    categories: PublicNavCategory[];
  };
}

/**
 * 游客可见的导航数据：公开分类（两级）+ 其下的公开链接。
 * 供 SPA 首页渲染，无需鉴权。
 */
export async function publicNavHandler(db: DB): Promise<PublicNavResult> {
  // 公开分类全量（分类数量级小，不分页）
  const cats = await db.select({
    id: schema.categorys.id, name: schema.categorys.name,
    fid: schema.categorys.fid, fontIcon: schema.categorys.fontIcon,
    description: schema.categorys.description,
  }).from(schema.categorys)
    .where(eq(schema.categorys.property, 0))
    .orderBy(desc(schema.categorys.weight), desc(schema.categorys.id))
    .all();

  const catIds = cats.map(c => c.id);
  const pubLinks = catIds.length
    ? await db.select({
        id: schema.links.id, fid: schema.links.fid, title: schema.links.title,
        url: schema.links.url, description: schema.links.description,
        fontIcon: schema.links.fontIcon, urlStandby: schema.links.urlStandby,
      }).from(schema.links)
        .where(and(eq(schema.links.property, 0), inArray(schema.links.fid, catIds)))
        .orderBy(desc(schema.links.weight), desc(schema.links.id))
        .all()
    : [];

  // 组装两级树：顶级 → children（二级）→ 各自 links（二级分类的链接归二级，顶级直挂的归顶级）
  const byId = new Map<number, PublicNavCategory>();
  const tops: PublicNavCategory[] = [];
  for (const c of cats) {
    byId.set(c.id, { id: c.id, name: c.name, font_icon: c.fontIcon, description: c.description, children: [], links: [] });
  }
  for (const c of cats) {
    const node = byId.get(c.id)!;
    if (c.fid === 0 || !byId.has(c.fid)) tops.push(node);
    else byId.get(c.fid)!.children.push(node);
  }
  for (const l of pubLinks) {
    byId.get(l.fid)?.links.push({
      id: l.id, fid: l.fid, title: l.title, url: l.url,
      description: l.description, font_icon: l.fontIcon, url_standby: l.urlStandby,
    });
  }

  // 站点标题：on_options.site_title，缺省 OneNav
  const titleRow = await db.select().from(schema.options)
    .where(eq(schema.options.key, 'site_title')).get();

  return {
    code: 0,
    data: {
      site_title: titleRow?.value || 'OneNav',
      site_subtitle: '',
      categories: tops,
    },
  };
}
```

- [ ] **Step 5: 跑全部测试确认通过**

```bash
cd /Users/taowen/project/navbook/workers && pnpm test
```

Expected: md5 5 + auth 8 + category 9 + link 6 + public 2 = 全部 PASS（包括 Task 9 遗留的那条）。

- [ ] **Step 6: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/src/handlers workers/tests/handlers
git commit -m "feat(handlers): link CRUD, guest visibility, public_nav (TDD)"
```

---

## Task 11: Auth / Init / Login handlers

**Files:**
- Create: `workers/src/handlers/auth.ts`
- Create: `workers/src/handlers/init.ts`

约定：**所有 handler 只返回纯对象**（`{ code, ... }`），不返回 Response；`Set-Cookie` 等副作用由 router 层处理。

- [ ] **Step 1: 实现 auth handlers**

创建 `workers/src/handlers/auth.ts`：

```ts
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { md5 } from '../lib/md5';

export async function checkLoginHandler(
  db: DB, token: string | undefined,
): Promise<{ code: number; data?: { username: string }; msg?: string }> {
  const user = await db.select().from(schema.users).limit(1).get();
  if (!user) return { code: -2000, msg: '请先初始化用户！' };
  if (token) {
    const skRow = await db.select().from(schema.options)
      .where(eq(schema.options.key, 'SecretKey')).get();
    if (token === md5(user.username + (skRow?.value ?? ''))) {
      return { code: 0, data: { username: user.username } };
    }
  }
  return { code: -1002, msg: 'Authorization failure!' };
}

export async function createSkHandler(db: DB): Promise<{ code: 0; data: { secret_key: string } }> {
  const user = await db.select().from(schema.users).limit(1).get();
  if (!user) throw new Error('请先初始化用户！');
  const sk = crypto.randomUUID().replace(/-/g, '');
  await db.insert(schema.options).values({ key: 'SecretKey', value: sk })
    .onConflictDoUpdate({ target: schema.options.key, set: { value: sk } });
  return { code: 0, data: { secret_key: sk } };
}

export async function appInfoHandler(
  db: DB, clientVersion: string,
): Promise<{ code: 0; data: { version: string; client_version: string; has_user: boolean; username: string | null } }> {
  const user = await db.select().from(schema.users).limit(1).get();
  return {
    code: 0,
    data: {
      version: '1.0.0',
      client_version: clientVersion,
      has_user: !!user,
      username: user?.username ?? null,
    },
  };
}
```

- [ ] **Step 2: 实现 init / login handlers**

创建 `workers/src/handlers/init.ts`：

```ts
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { md5 } from '../lib/md5';

export async function initHandler(
  db: DB, username: string, password: string,
): Promise<{ code: 0; data: { username: string; secret_key: string } }> {
  const existing = await db.select().from(schema.users).limit(1).get();
  if (existing) throw new Error('已经初始化过，如需重置请清空 on_users 表');

  await db.insert(schema.users).values({
    username,
    passwordHash: md5(password),
    secretKey: null,
    createdAt: Math.floor(Date.now() / 1000),
  });
  // 同时生成 SecretKey（插件 token 用）
  const sk = crypto.randomUUID().replace(/-/g, '');
  await db.insert(schema.options).values({ key: 'SecretKey', value: sk })
    .onConflictDoUpdate({ target: schema.options.key, set: { value: sk } });
  return { code: 0, data: { username, secret_key: sk } };
}

export async function loginHandler(
  db: DB, password: string, ua: string,
): Promise<{ code: number; data?: { username: string; cookie: string }; msg?: string }> {
  const user = await db.select().from(schema.users).limit(1).get();
  if (!user) return { code: -2000, msg: '用户未初始化' };
  // 兼容明文（旧数据）与 md5 两种存储
  if (user.passwordHash !== md5(password) && user.passwordHash !== password) {
    return { code: -1002, msg: '密码错误' };
  }
  const cookie = md5(user.username + user.passwordHash + 'onenav' + ua);
  return { code: 0, data: { username: user.username, cookie } };
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/src/handlers/auth.ts workers/src/handlers/init.ts
git commit -m "feat(handlers): check_login / create_sk / app_info / init / login"
```

---

## Task 12: Hono 路由 + Worker 入口

**Files:**
- Create: `workers/src/router.ts`
- Modify: `workers/src/index.ts`

- [ ] **Step 1: 写 router.ts**

创建 `workers/src/router.ts`。要点：
- 列表类端点用 `optionalAuthMiddleware`（游客可见公开数据，插件带 token 可见全部）
- 写操作用 `authMiddleware`
- `/api/login` 成功时由服务端 `Set-Cookie`（HttpOnly，前端不碰 cookie 值）
- `/api/*` 未知方法返回 JSON 404（不能落到 SPA fallback，否则会返回 index.html）
- SPA fallback 放最后，交给 `ASSETS.fetch`（配合 Task 19 的 `not_found_handling = "single-page-application"`，深链刷新返回 index.html）

```ts
import { Hono } from 'hono';
import type { AppEnv } from './types';
import { getDb } from './db/client';
import { corsMiddleware } from './middleware/cors';
import { authMiddleware, optionalAuthMiddleware, authenticate } from './middleware/auth';
import { errorMiddleware } from './middleware/error';
import { getCookie } from 'hono/cookie';
import {
  addCategoryHandler, editCategoryHandler, delCategoryHandler,
  categoryListHandler, getACategoryHandler,
} from './handlers/category';
import {
  addLinkHandler, editLinkHandler, delLinkHandler,
  linkListHandler, qCategoryLinkHandler, getALinkHandler,
} from './handlers/link';
import { publicNavHandler } from './handlers/public';
import { checkLoginHandler, createSkHandler, appInfoHandler } from './handlers/auth';
import { initHandler, loginHandler } from './handlers/init';
import {
  addCategorySchema, editCategorySchema, delCategorySchema, getACategorySchema,
  addLinkSchema, editLinkSchema, delLinkSchema, getALinkSchema, qCategoryLinkSchema,
  initSchema, loginSchema,
} from './lib/validate';

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', errorMiddleware);
  app.use('*', corsMiddleware);
  app.use('*', async (c, next) => {
    c.set('db', getDb(c.env.DB));
    c.set('isAuthed', false);
    c.set('username', null);
    await next();
  });

  // ---------- 公开端点（无鉴权） ----------

  app.post('/api/app_info', async c => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    return c.json(await appInfoHandler(c.get('db'), String(body.version ?? '0')));
  });

  app.post('/api/check_login', async c => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    return c.json(await checkLoginHandler(c.get('db'), body.token ? String(body.token) : undefined));
  });

  app.post('/api/init', async c => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const parsed = initSchema.parse({ username: body.username, password: body.password });
    return c.json(await initHandler(c.get('db'), parsed.username, parsed.password));
  });

  app.post('/api/login', async c => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const parsed = loginSchema.parse({ password: body.password });
    const result = await loginHandler(
      c.get('db'), parsed.password, c.req.header('User-Agent') ?? '',
    );
    if (result.code === 0 && result.data) {
      c.header('Set-Cookie',
        `key=${result.data.cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
    }
    return c.json(result);
  });

  app.get('/api/session', async c => {
    const username = await authenticate(
      c.get('db'), c.env.USERNAME,
      c.req.header('X-Token'), getCookie(c, 'key'),
      c.req.header('User-Agent') ?? '',
    );
    return c.json({ code: 0, data: { username } });
  });

  app.get('/api/public_nav', async c => {
    return c.json(await publicNavHandler(c.get('db')));
  });

  // ---------- 列表端点（可选鉴权：游客只见公开数据） ----------

  app.post('/api/category_list', optionalAuthMiddleware, async c => {
    const q = c.req.query();
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '10', 10) || 10));
    return c.json(await categoryListHandler(c.get('db'), page, limit, c.get('isAuthed')));
  });

  app.post('/api/link_list', optionalAuthMiddleware, async c => {
    const q = c.req.query();
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '10', 10) || 10));
    const categoryId = body.category_id ? parseInt(String(body.category_id), 10) : undefined;
    return c.json(await linkListHandler(c.get('db'), page, limit, c.get('isAuthed'), categoryId));
  });

  app.post('/api/q_category_link', optionalAuthMiddleware, async c => {
    const q = c.req.query();
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const fid = parseInt(String(body.category_id ?? q.category_id ?? q.id ?? '0'), 10);
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '10', 10) || 10));
    const parsed = qCategoryLinkSchema.parse({ category_id: fid });
    return c.json(await qCategoryLinkHandler(c.get('db'), parsed.category_id, page, limit, c.get('isAuthed')));
  });

  app.post('/api/get_a_category', optionalAuthMiddleware, async c => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const q = c.req.query();
    const parsed = getACategorySchema.parse({ id: body.id ?? q.id });
    return c.json(await getACategoryHandler(c.get('db'), parsed.id));
  });

  app.post('/api/get_a_link', optionalAuthMiddleware, async c => {
    const q = c.req.query();
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const parsed = getALinkSchema.parse({ id: body.id ?? q.id });
    return c.json(await getALinkHandler(c.get('db'), parsed.id, c.get('isAuthed')));
  });

  // ---------- 写操作（强制鉴权） ----------

  app.post('/api/add_category', authMiddleware, async c => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const p = addCategorySchema.parse(body);
    return c.json(await addCategoryHandler(c.get('db'), {
      name: p.name, property: p.property, weight: p.weight,
      description: p.description, font_icon: p.font_icon, fid: p.fid,
    }));
  });

  app.post('/api/edit_category', authMiddleware, async c => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const p = editCategorySchema.parse(body);
    return c.json(await editCategoryHandler(c.get('db'), p.id, {
      name: p.name, property: p.property, weight: p.weight,
      description: p.description, font_icon: p.font_icon, fid: p.fid,
    }));
  });

  app.post('/api/del_category', authMiddleware, async c => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const p = delCategorySchema.parse(body);
    return c.json(await delCategoryHandler(c.get('db'), p.id));
  });

  app.post('/api/add_link', authMiddleware, async c => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const p = addLinkSchema.parse(body);
    return c.json(await addLinkHandler(c.get('db'), {
      fid: p.fid, title: p.title, url: p.url, description: p.description,
      weight: p.weight, property: p.property, url_standby: p.url_standby, font_icon: p.font_icon,
    }));
  });

  app.post('/api/edit_link', authMiddleware, async c => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const p = editLinkSchema.parse(body);
    return c.json(await editLinkHandler(c.get('db'), p.id, {
      fid: p.fid, title: p.title, url: p.url, description: p.description,
      weight: p.weight, property: p.property, url_standby: p.url_standby, font_icon: p.font_icon,
    }));
  });

  app.post('/api/del_link', authMiddleware, async c => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const p = delLinkSchema.parse(body);
    return c.json(await delLinkHandler(c.get('db'), p.id));
  });

  app.post('/api/create_sk', authMiddleware, async c => {
    return c.json(await createSkHandler(c.get('db')));
  });

  // ---------- SPA fallback（放最后） ----------

  app.all('*', async c => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ code: -404, msg: 'method not found!' }, 404);
    }
    return c.env.ASSETS.fetch(c.req.raw);
  });

  return app;
}
```

- [ ] **Step 2: 重写 index.ts**

替换 `workers/src/index.ts`：

```ts
import { createApp } from './router';

export default createApp();
```

（Hono app 本身就是合法的 Worker 导出对象，`fetch(request, env, ctx)` 会被正确调用。）

- [ ] **Step 3: 本地启动 + curl 冒烟**

```bash
cd /Users/taowen/project/navbook/workers
(pnpm dev > /tmp/onenav-dev.log 2>&1 &)
sleep 8

# 公开端点
curl -s -X POST http://localhost:8787/api/app_info && echo
# → {"code":0,"data":{"version":"1.0.0",...,"has_user":false,...}}

# 初始化
curl -s -X POST http://localhost:8787/api/init -d "username=admin&password=test123" && echo
# → {"code":0,"data":{"username":"admin","secret_key":"..."}}

# 未带凭据的写操作 → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/api/add_category -d "name=x"
# → 401

# 公开导航（空库）
curl -s http://localhost:8787/api/public_nav && echo
# → {"code":0,"data":{"site_title":"OneNav",...,"categories":[]}}

pkill -f "wrangler dev" || true
```

注意：本地 D1 数据在 Task 3 已应用 migration；若 init 报"未初始化表"，先跑 `pnpm db:migrate:local`。**curl 触发的 init 会占用唯一的用户槽**，验证后重置本地库：

```bash
cd /Users/taowen/project/navbook/workers
rm -rf .wrangler/state/v3/d1 && pnpm db:migrate:local
```

- [ ] **Step 4: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/src/router.ts workers/src/index.ts
git commit -m "feat: wire Hono router (public/optional/required auth tiers) + SPA fallback"
```

---

## Task 13: Vite 8 + React + Tailwind 前端脚手架

**Files:**
- Create: `workers/web/`（Vite 8 项目）

- [ ] **Step 1: 用官方 Vite 模板初始化（脚手架优先）**

```bash
cd /Users/taowen/project/navbook/workers
pnpm create vite@latest web -- --template react-ts
```

Expected: 生成 `web/` 含 `package.json`、`vite.config.ts`、`tsconfig.json`、`src/`、`index.html`。

- [ ] **Step 2: 安装依赖（Tailwind 走 v3 + PostCSS 路线，不装 @tailwindcss/vite）**

```bash
cd /Users/taowen/project/navbook/workers/web
pnpm add react-router-dom @tanstack/react-query zustand
pnpm add -D tailwindcss@^3 postcss autoprefixer tsx tinyglobby
```

注意：**不要**安装 `@tailwindcss/vite`（那是 Tailwind v4 的插件）和 `@cloudflare/vite-plugin`（本方案不需要）。

- [ ] **Step 3: 初始化 Tailwind v3 配置**

```bash
cd /Users/taowen/project/navbook/workers/web
npx tailwindcss init -p
```

Expected: 生成 `tailwind.config.js`、`postcss.config.js`。

修改 `tailwind.config.js`：

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 4: 替换 src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 5: 配置 vite.config.ts（@ alias + 输出到 ../dist + dev proxy）**

替换 `workers/web/vite.config.ts`：

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/click': 'http://localhost:8787',
    },
  },
});
```

- [ ] **Step 6: 配置 tsconfig paths（与 vite alias 对齐）**

在 `workers/web/tsconfig.json` 的 `compilerOptions` 中加入（若模板生成的是 tsconfig 引用结构，加到被引用的 app 配置里）：

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

- [ ] **Step 7: 验证构建**

```bash
cd /Users/taowen/project/navbook/workers/web && pnpm build
ls ../dist
```

Expected: `../dist/`（即 `workers/dist/`）含 `index.html` 和 `assets/`。

- [ ] **Step 8: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/web
git commit -m "chore(web): scaffold Vite 8 + React + Tailwind v3"
```

（`.gitignore` 已覆盖 `node_modules/`、`dist/`。）

---

## Task 14: 主题系统 — loader + ThemeRenderer + default2

**Files:**
- Create: `workers/web/src/themes/loader.ts`
- Create: `workers/web/src/themes/default2/index.tsx`
- Create: `workers/web/src/themes/default2/tokens.css`
- Create: `workers/web/src/components/ThemeRenderer.tsx`
- Create: `workers/web/scripts/inline-tokens.ts`
- Modify: `workers/web/index.html`
- Modify: `workers/web/package.json`

- [ ] **Step 1: 写 default2 tokens.css**

创建 `workers/web/src/themes/default2/tokens.css`：

```css
:root[data-theme="default2"] {
  --color-primary: #3b82f6;
  --color-primary-hover: #2563eb;
  --color-bg: #ffffff;
  --color-bg-subtle: #f9fafb;
  --color-text: #111827;
  --color-text-subtle: #6b7280;
  --color-border: #e5e7eb;
  --radius: 8px;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
:root[data-theme="default2"][data-mode="dark"] {
  --color-bg: #1a1a1a;
  --color-bg-subtle: #222222;
  --color-text: #e5e5e5;
  --color-text-subtle: #9ca3af;
  --color-border: #333333;
}
```

- [ ] **Step 2: 写 default2 主题组件（渲染两级分类）**

创建 `workers/web/src/themes/default2/index.tsx`：

```tsx
import type { NavData } from '@/types/nav';

export default function Default2({ data }: { data: NavData }) {
  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold" style={{ color: 'var(--color-text)' }}>
          {data.site_title}
        </h1>
        {data.site_subtitle && (
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-subtle)' }}>
            {data.site_subtitle}
          </p>
        )}
      </header>
      <div className="space-y-10">
        {data.categories.map(cat => (
          <section key={cat.id}>
            <h2
              className="text-xl font-semibold mb-4 flex items-center gap-2"
              style={{ color: 'var(--color-text)' }}
            >
              {cat.font_icon && <span className={cat.font_icon} aria-hidden />}
              {cat.name}
            </h2>

            {/* 顶级分类直挂的链接 */}
            {cat.links.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-4">
                {cat.links.map(link => <LinkCard key={link.id} link={link} />)}
              </div>
            )}

            {/* 二级分类 */}
            {cat.children.map(sub => (
              <div key={sub.id} className="mb-4">
                <h3
                  className="text-sm font-medium mb-2 uppercase tracking-wide"
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  {sub.font_icon && <span className={`${sub.font_icon} mr-1`} aria-hidden />}
                  {sub.name}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {sub.links.map(link => <LinkCard key={link.id} link={link} />)}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}

function LinkCard({ link }: { link: NavData['categories'][number]['links'][number] }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-3 transition hover:shadow-md"
      style={{
        backgroundColor: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        {link.font_icon && <span className={link.font_icon} aria-hidden />}
        <span className="font-medium truncate text-sm" style={{ color: 'var(--color-text)' }}>
          {link.title}
        </span>
      </div>
      {link.description && (
        <p className="text-xs truncate" style={{ color: 'var(--color-text-subtle)' }}>
          {link.description}
        </p>
      )}
    </a>
  );
}
```

- [ ] **Step 3: 写 loader.ts（自动发现，无注册表）**

创建 `workers/web/src/themes/loader.ts`：

```ts
import type { ComponentType } from 'react';
import type { NavData } from '@/types/nav';

const components = import.meta.glob<{ default: ComponentType<{ data: NavData }> }>('./*/index.tsx');
const tokens = import.meta.glob<string>('./*/tokens.css', { query: '?raw', import: 'default' });

export const themeIds = Object.keys(components)
  .map(p => p.replace(/^\.\//, '').replace(/\/index\.tsx$/, ''));

export async function loadTheme(id: string) {
  const compLoader = components[`./${id}/index.tsx`];
  if (!compLoader) throw new Error(`Theme not found: ${id}`);
  const [compMod, tokensStr] = await Promise.all([
    compLoader(),
    tokens[`./${id}/tokens.css`](),
  ]);
  return { Component: compMod.default, tokens: tokensStr };
}

export const displayName = (id: string) =>
  id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
```

- [ ] **Step 4: 写 ThemeRenderer**

创建 `workers/web/src/components/ThemeRenderer.tsx`：

```tsx
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { NavData } from '@/types/nav';
import { loadTheme } from '@/themes/loader';

export function ThemeRenderer({ themeId, data }: { themeId: string; data: NavData }) {
  const [Component, setComponent] = useState<ComponentType<{ data: NavData }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTheme(themeId).then(t => {
      if (cancelled) return;
      setComponent(() => t.Component);
      document.documentElement.dataset.theme = themeId;
      try { localStorage.setItem('onenav.theme', themeId); } catch { /* 忽略 */ }
    }).catch(console.error);
    return () => { cancelled = true; };
  }, [themeId]);

  // tokens 已内联在 index.html（构建期），此处无需注入 CSS，等待组件到达即无闪烁
  if (!Component) return null;
  return <Component data={data} />;
}
```

- [ ] **Step 5: 写 inline-tokens 构建脚本**

创建 `workers/web/scripts/inline-tokens.ts`：

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'tinyglobby';

const files = globSync('src/themes/*/tokens.css');
if (files.length === 0) throw new Error('No theme tokens found under src/themes/*/');

const merged = files
  .map(f => `/* ${f} */\n${readFileSync(f, 'utf8').trim()}`)
  .join('\n\n');

const html = readFileSync('index.html', 'utf8');
const next = html.replace(
  /<style id="theme-tokens">[\s\S]*?<\/style>/,
  `<style id="theme-tokens">\n${merged}\n</style>`,
);
if (next === html) throw new Error('index.html missing <style id="theme-tokens"> placeholder');
writeFileSync('index.html', next);
console.log(`Inlined ${files.length} theme token files: ${files.join(', ')}`);
```

- [ ] **Step 6: 修改 index.html（占位 style + 预设 data-theme）**

在 `workers/web/index.html` 的 `<head>` 内（其他 link/script 之前）插入：

```html
    <style id="theme-tokens"></style>
    <script>
      try {
        var t = localStorage.getItem('onenav.theme') || 'default2';
        document.documentElement.dataset.theme = t;
      } catch (e) {}
    </script>
```

- [ ] **Step 7: package.json 挂 prebuild**

在 `workers/web/package.json` 的 scripts 中加入：

```json
{
  "scripts": {
    "prebuild": "tsx scripts/inline-tokens.ts",
    "build": "vite build",
    "dev": "vite"
  }
}
```

- [ ] **Step 8: 验证构建产物包含 tokens**

```bash
cd /Users/taowen/project/navbook/workers/web && pnpm build
grep -c "color-primary" ../dist/index.html
```

Expected: 输出 ≥ 1（tokens 已内联进产物 HTML）；控制台输出 `Inlined 1 theme token files`。

- [ ] **Step 9: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/web/src/themes workers/web/src/components/ThemeRenderer.tsx workers/web/scripts workers/web/index.html workers/web/package.json
git commit -m "feat(web): theme system (auto-discovery loader + ThemeRenderer + default2)"
```

---

## Task 15: 前端 — types + API client（cookie 鉴权）+ hooks + Home

**Files:**
- Create: `workers/web/src/types/nav.ts`
- Create: `workers/web/src/api/client.ts`
- Create: `workers/web/src/api/hooks.ts`
- Create: `workers/web/src/routes/Home.tsx`

- [ ] **Step 1: 写 NavData 类型（两级分类 + links）**

创建 `workers/web/src/types/nav.ts`：

```ts
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
  children: NavCategory[];
  links: NavLink[];
}
export interface NavData {
  site_title: string;
  site_subtitle: string;
  categories: NavCategory[];
}
```

- [ ] **Step 2: 写 API client**

admin SPA 与 API 同源，**cookie 由浏览器自动携带**（fetch 默认 `credentials: 'same-origin'`），前端不传 token、不读 cookie（HttpOnly）。创建 `workers/web/src/api/client.ts`：

```ts
async function post<T = any>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) fd.append(k, String(v));
  }
  const res = await fetch(`/api/${method}`, { method: 'POST', body: fd });
  return res.json();
}

async function get<T = any>(path: string): Promise<T> {
  const res = await fetch(path);
  return res.json();
}

export const api = {
  init: (username: string, password: string) => post('init', { username, password }),
  login: (password: string) => post('login', { password }),
  session: () => get<{ code: number; data: { username: string | null } }>('/api/session'),
  publicNav: () => get<{ code: number; data: import('@/types/nav').NavData }>('/api/public_nav'),

  listCategories: (page = 1, limit = 100) => post('category_list', { page, limit }),
  addCategory: (data: Record<string, unknown>) => post('add_category', data),
  editCategory: (data: Record<string, unknown>) => post('edit_category', data),
  delCategory: (id: number) => post('del_category', { id }),

  listLinks: (page = 1, limit = 100, category_id?: number) => post('link_list', { page, limit, category_id }),
  addLink: (data: Record<string, unknown>) => post('add_link', data),
  editLink: (data: Record<string, unknown>) => post('edit_link', data),
  delLink: (id: number) => post('del_link', { id }),
};
```

（列表端点带不带凭据由浏览器 cookie 决定：管理员登录后自动看到全部，游客只看公开。）

- [ ] **Step 3: 写 TanStack Query hooks**

创建 `workers/web/src/api/hooks.ts`：

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export function usePublicNav() {
  return useQuery({ queryKey: ['publicNav'], queryFn: api.publicNav });
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api.listCategories() });
}

export function useLinks(categoryId?: number) {
  return useQuery({
    queryKey: ['links', categoryId],
    queryFn: () => api.listLinks(1, 100, categoryId),
  });
}

function useInvalidatingMutation<TVars>(
  mutationFn: (vars: TVars) => Promise<unknown>,
  keysToInvalidate: string[][],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      for (const key of keysToInvalidate) qc.invalidateQueries({ queryKey: key });
    },
  });
}

export const useAddCategory = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.addCategory(data),
    [['categories'], ['publicNav']]);
export const useEditCategory = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.editCategory(data),
    [['categories'], ['publicNav']]);
export const useDelCategory = () =>
  useInvalidatingMutation((id: number) => api.delCategory(id),
    [['categories'], ['publicNav']]);
export const useAddLink = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.addLink(data),
    [['links'], ['publicNav']]);
export const useEditLink = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.editLink(data),
    [['links'], ['publicNav']]);
export const useDelLink = () =>
  useInvalidatingMutation((id: number) => api.delLink(id),
    [['links'], ['publicNav']]);
```

- [ ] **Step 4: 写 Home 页面（数据来自 /api/public_nav）**

创建 `workers/web/src/routes/Home.tsx`：

```tsx
import { useState } from 'react';
import { usePublicNav } from '@/api/hooks';
import { ThemeRenderer } from '@/components/ThemeRenderer';
import { themeIds, displayName } from '@/themes/loader';

const DEFAULT_THEME = 'default2';

export function Home() {
  const { data, isLoading, isError } = usePublicNav();
  const [themeId, setThemeId] = useState(() => {
    try { return localStorage.getItem('onenav.theme') || DEFAULT_THEME; }
    catch { return DEFAULT_THEME; }
  });

  if (isError) return <div className="p-8">加载失败，请刷新重试</div>;
  if (isLoading || !data?.data) return <div className="p-8">加载中...</div>;

  return (
    <>
      <div className="fixed top-4 right-4 z-50">
        <select
          className="px-3 py-1 border rounded text-sm"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
          value={themeId}
          onChange={e => setThemeId(e.target.value)}
          aria-label="切换主题"
        >
          {themeIds.map(id => (
            <option key={id} value={id}>{displayName(id)}</option>
          ))}
        </select>
      </div>
      <ThemeRenderer themeId={themeId} data={data.data} />
    </>
  );
}
```

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/web/src/types workers/web/src/api workers/web/src/routes/Home.tsx
git commit -m "feat(web): typed API client (cookie auth), query hooks, Home with real data"
```

---

## Task 16: 前端 — auth store + Login / Init + 路由

**Files:**
- Create: `workers/web/src/stores/auth.ts`
- Create: `workers/web/src/routes/Login.tsx`
- Create: `workers/web/src/routes/Init.tsx`
- Create: `workers/web/src/App.tsx`
- Modify: `workers/web/src/main.tsx`

- [ ] **Step 1: 写 auth store（只存 username；cookie 是 HttpOnly 不可读）**

创建 `workers/web/src/stores/auth.ts`：

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  username: string | null;
  setUsername: (username: string | null) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    set => ({
      username: null,
      setUsername: username => set({ username }),
      clear: () => set({ username: null }),
    }),
    { name: 'onenav-auth' },
  ),
);
```

- [ ] **Step 2: 写 Login 页面（依赖服务端 Set-Cookie，前端不碰 cookie 值）**

创建 `workers/web/src/routes/Login.tsx`：

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useAuth } from '@/stores/auth';

export function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const setUsername = useAuth(s => s.setUsername);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.login(password);
      if (res.code === 0) {
        // cookie 已由服务端 Set-Cookie 下发（HttpOnly）
        setUsername(res.data.username);
        navigate('/admin');
      } else {
        setError(res.msg ?? '登录失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form
        onSubmit={submit}
        className="w-80 space-y-4 p-6 border rounded"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', borderRadius: 'var(--radius)' }}
      >
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>登录</h1>
        <input
          type="password"
          placeholder="密码"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full px-3 py-2 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
          autoFocus
        />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full py-2 rounded text-white disabled:opacity-50"
          style={{ background: 'var(--color-primary)' }}
        >
          {busy ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: 写 Init 页面（成功后去 /login，不是 /admin）**

创建 `workers/web/src/routes/Init.tsx`：

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';

export function Init() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.init(username, password);
      if (res.code === 0) {
        navigate('/login');  // 初始化只建账号；登录（下发 cookie）走 /login
      } else {
        setError(res.msg ?? '初始化失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form
        onSubmit={submit}
        className="w-80 space-y-4 p-6 border rounded"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', borderRadius: 'var(--radius)' }}
      >
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>首次使用 · 设置管理员</h1>
        <input
          placeholder="用户名"
          value={username}
          onChange={e => setUsername(e.target.value)}
          className="w-full px-3 py-2 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <input
          type="password"
          placeholder="密码（≥6 位）"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full px-3 py-2 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full py-2 rounded text-white disabled:opacity-50"
          style={{ background: 'var(--color-primary)' }}
        >
          {busy ? '初始化中...' : '初始化'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: 写 App.tsx 路由 + main.tsx**

创建 `workers/web/src/App.tsx`：

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Home } from './routes/Home';
import { Login } from './routes/Login';
import { Init } from './routes/Init';
import { AdminLayout } from './routes/Admin/Layout';
import { AdminCategories } from './routes/Admin/Categories';
import { AdminLinks } from './routes/Admin/Links';

const qc = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/init" element={<Init />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/categories" replace />} />
            <Route path="categories" element={<AdminCategories />} />
            <Route path="links" element={<AdminLinks />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

替换 `workers/web/src/main.tsx`：

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

删除模板自带的 `src/App.css` 和 `src/assets/`（如引用报错，同步清理 import）。

- [ ] **Step 5: 验证构建**

```bash
cd /Users/taowen/project/navbook/workers/web && pnpm build
```

Expected: 构建成功（Admin 页面在 Task 17 创建，此处先创建占位或接受构建警告 —— 为保证可构建，Task 16 与 Task 17 在同一工作流连续执行；若单独执行 Task 16，临时把 App.tsx 中两个 Admin import 注释掉）。

- [ ] **Step 6: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/web/src
git commit -m "feat(web): auth store, Login/Init pages, SPA routing"
```

---

## Task 17: 前端 — Admin 后台（Categories + Links）

**Files:**
- Create: `workers/web/src/routes/Admin/Layout.tsx`
- Create: `workers/web/src/routes/Admin/Categories.tsx`
- Create: `workers/web/src/routes/Admin/Links.tsx`

- [ ] **Step 1: 写 Admin Layout（挂载时 ping /api/session 恢复登录态）**

创建 `workers/web/src/routes/Admin/Layout.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { Outlet, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { api } from '@/api/client';

export function AdminLayout() {
  const username = useAuth(s => s.username);
  const setUsername = useAuth(s => s.setUsername);
  const clear = useAuth(s => s.clear);
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api.session().then(res => {
      if (res?.data?.username) setUsername(res.data.username);
      else clear();
      setChecked(true);
    }).catch(() => setChecked(true));
  }, [setUsername, clear]);

  if (!checked) return null;                       // 等待会话探测，避免闪烁跳转
  if (!username) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen flex">
      <aside className="w-48 border-r p-4" style={{ borderColor: 'var(--color-border)' }}>
        <h1 className="font-bold mb-4" style={{ color: 'var(--color-text)' }}>OneNav 后台</h1>
        <nav className="space-y-2 text-sm">
          <NavLink
            to="/admin/categories"
            className={({ isActive }) => (isActive ? 'font-bold' : '')}
            style={{ color: 'var(--color-text)' }}
          >
            分类管理
          </NavLink>
          <br />
          <NavLink
            to="/admin/links"
            className={({ isActive }) => (isActive ? 'font-bold' : '')}
            style={{ color: 'var(--color-text)' }}
          >
            链接管理
          </NavLink>
          <br />
          <button
            className="text-red-500"
            onClick={() => {
              // cookie 由服务端管理，过期自动失效；此处仅清前端状态
              clear();
              navigate('/');
            }}
          >
            退出
          </button>
        </nav>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: 写 AdminCategories**

创建 `workers/web/src/routes/Admin/Categories.tsx`：

```tsx
import { useState } from 'react';
import { useCategories, useAddCategory, useEditCategory, useDelCategory } from '@/api/hooks';

export function AdminCategories() {
  const { data, isLoading } = useCategories();
  const add = useAddCategory();
  const edit = useEditCategory();
  const del = useDelCategory();

  const [name, setName] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [error, setError] = useState('');

  if (isLoading) return <div>加载中...</div>;
  const cats: any[] = data?.data ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return;
    try {
      const payload = { name, property: 0, weight: 0, description: '', font_icon: '', fid: 0 };
      if (editId) await edit.mutateAsync({ ...payload, id: editId });
      else await add.mutateAsync(payload);
      setEditId(null);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--color-text)' }}>分类管理</h2>
      <form className="mb-4 flex gap-2" onSubmit={submit}>
        <input
          placeholder="分类名称"
          value={name}
          onChange={e => setName(e.target.value)}
          className="px-3 py-1 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <button
          type="submit"
          disabled={add.isPending || edit.isPending}
          className="px-4 py-1 rounded text-white disabled:opacity-50"
          style={{ background: 'var(--color-primary)' }}
        >
          {editId ? '更新' : '新增'}
        </button>
        {editId && (
          <button
            type="button"
            onClick={() => { setEditId(null); setName(''); }}
            className="px-4 py-1 border rounded"
            style={{ borderColor: 'var(--color-border)' }}
          >
            取消
          </button>
        )}
      </form>
      {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
            <th className="text-left py-2">ID</th>
            <th className="text-left py-2">名称</th>
            <th className="text-left py-2">属性</th>
            <th className="text-left py-2">权重</th>
            <th className="text-left py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {cats.map(c => (
            <tr key={c.id} className="border-b" style={{ borderColor: 'var(--color-border)' }}>
              <td className="py-2">{c.id}</td>
              <td className="py-2">{c.name}</td>
              <td className="py-2">{c.property === 1 ? '私有' : '公开'}</td>
              <td className="py-2">{c.weight}</td>
              <td className="py-2 space-x-2">
                <button className="text-blue-500" onClick={() => { setEditId(c.id); setName(c.name); }}>
                  编辑
                </button>
                <button
                  className="text-red-500"
                  onClick={() => {
                    if (confirm(`删除分类「${c.name}」？`)) del.mutate(c.id);
                  }}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: 写 AdminLinks**

创建 `workers/web/src/routes/Admin/Links.tsx`：

```tsx
import { useState } from 'react';
import { useLinks, useCategories, useAddLink, useDelLink } from '@/api/hooks';

export function AdminLinks() {
  const { data: catData } = useCategories();
  const { data: linkData, isLoading } = useLinks();
  const add = useAddLink();
  const del = useDelLink();

  const [form, setForm] = useState({ fid: 0, title: '', url: '', description: '' });
  const [error, setError] = useState('');

  if (isLoading) return <div>加载中...</div>;
  const cats: any[] = catData?.data ?? [];
  const links: any[] = linkData?.data ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.fid || !form.title.trim() || !form.url.trim()) {
      setError('分类、标题、URL 均为必填');
      return;
    }
    try {
      await add.mutateAsync({
        ...form,
        weight: 0, property: 0, url_standby: '', font_icon: '',
      });
      setForm({ fid: 0, title: '', url: '', description: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--color-text)' }}>链接管理</h2>
      <form className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-2" onSubmit={submit}>
        <select
          value={form.fid}
          onChange={e => setForm({ ...form, fid: parseInt(e.target.value, 10) })}
          className="px-2 py-1 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <option value={0}>选择分类</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input
          placeholder="标题"
          value={form.title}
          onChange={e => setForm({ ...form, title: e.target.value })}
          className="px-2 py-1 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <input
          placeholder="URL（https://...）"
          value={form.url}
          onChange={e => setForm({ ...form, url: e.target.value })}
          className="px-2 py-1 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <input
          placeholder="描述（可选）"
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
          className="px-2 py-1 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <button
          type="submit"
          disabled={add.isPending}
          className="px-4 py-1 rounded text-white disabled:opacity-50"
          style={{ background: 'var(--color-primary)' }}
        >
          新增链接
        </button>
      </form>
      {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
            <th className="text-left py-2">ID</th>
            <th className="text-left py-2">标题</th>
            <th className="text-left py-2">URL</th>
            <th className="text-left py-2">分类</th>
            <th className="text-left py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {links.map(l => (
            <tr key={l.id} className="border-b" style={{ borderColor: 'var(--color-border)' }}>
              <td className="py-2">{l.id}</td>
              <td className="py-2">{l.title}</td>
              <td className="py-2 text-xs truncate max-w-xs">{l.url}</td>
              <td className="py-2">{l.categoryName}</td>
              <td className="py-2">
                <button
                  className="text-red-500"
                  onClick={() => {
                    if (confirm(`删除链接「${l.title}」？`)) del.mutate(l.id);
                  }}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: 验证构建**

```bash
cd /Users/taowen/project/navbook/workers/web && pnpm build
```

Expected: 构建成功。

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/web/src/routes/Admin
git commit -m "feat(web): admin pages for categories and links"
```

---

## Task 18: 端到端验证（本地）

**Files:** 无（纯验证）

- [ ] **Step 1: 启动 Worker + Vite dev**

```bash
cd /Users/taowen/project/navbook/workers
pnpm db:migrate:local
(pnpm dev > /tmp/onenav-dev.log 2>&1 &)
(cd web && pnpm dev > /tmp/onenav-web.log 2>&1 &)
sleep 8
curl -s http://localhost:5173/ -o /dev/null -w "%{http_code}\n"
```

Expected: `200`。

- [ ] **Step 2: 浏览器验证 http://localhost:5173/**

- 首页：default2 主题渲染，标题 OneNav，右上角主题切换器存在（仅 Default2 一项）
- 未初始化时：访问 `/init` → 表单 → 提交 → 跳转 `/login`
- `/login` 输入密码 → 跳转 `/admin/categories`
- 新增分类「工具」→ 列表出现该行，**首页刷新后出现对应分类区块**
- 在链接管理新增链接（分类选「工具」，URL 填 `https://github.com`）→ 列表出现，首页出现链接卡片
- 退出后台后访问 `/admin` → 被重定向到 `/login`
- 退出后台后首页仍显示公开数据（游客模式）

- [ ] **Step 3: 插件视角冒烟（模拟 X-Token 调用）**

```bash
SK=$(sqlite3 /Users/taowen/project/navbook/workers/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite "SELECT value FROM on_options WHERE key='SecretKey';")
TOKEN=$(node -e "const {md5}=require('js-md5');..." 2>/dev/null || true)
# 简化：用 python 算 token
TOKEN=$(python3 -c "import hashlib;print(hashlib.md5(('admin'+'$SK').encode()).hexdigest())")
curl -s -X POST http://localhost:8787/api/category_list -H "X-Token: $TOKEN" | head -c 200 && echo
curl -s -X POST http://localhost:8787/api/add_link \
  -H "X-Token: $TOKEN" \
  -d "fid=1&title=Ext&url=https://ext.example.com" && echo
```

Expected: category_list 返回全部分类；add_link 返回 `{"code":0,"id":N}` —— 证明浏览器插件（X-Token 模式）在无 cookie 情况下可正常读写。

- [ ] **Step 4: 关闭开发服务器**

```bash
pkill -f "wrangler dev" || true
pkill -f "vite" || true
```

- [ ] **Step 5: 确认工作区干净**

```bash
cd /Users/taowen/project/navbook && git status --short
```

Expected: 空（dist/、.wrangler/ 已被 gitignore）。

---

## Task 19: 部署到 Cloudflare（生产验证）

**Files:**
- Modify: `workers/wrangler.toml`

- [ ] **Step 1: wrangler.toml 加 assets（含 SPA fallback 关键配置）**

在 `workers/wrangler.toml` 末尾追加，并把 `database_id` 占位替换为 Step 3 输出的真实 ID：

```toml
[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

**`not_found_handling = "single-page-application"` 是深链路由（/init、/admin/links 刷新）不 404 的关键，不能省。**

- [ ] **Step 2: 登录 Cloudflare**

```bash
cd /Users/taowen/project/navbook/workers
pnpm wrangler login
```

Expected: 浏览器授权成功。

- [ ] **Step 3: 创建远程 D1 并替换 database_id**

```bash
pnpm wrangler d1 create onenav-db
```

Expected: 输出 `database_id`（UUID）。替换 wrangler.toml 中 `00000000-0000-4000-8000-000000000000`。

- [ ] **Step 4: 远程应用 migration**

```bash
pnpm db:migrate:remote
```

Expected: `🚣 Executed 1 command` 成功。

- [ ] **Step 5: 构建并部署**

```bash
cd /Users/taowen/project/navbook/workers
pnpm deploy    # = pnpm --filter web build && wrangler deploy
```

Expected: 输出 `Published onenav-workers` + workers.dev URL。

- [ ] **Step 6: 生产验证清单**

```bash
URL="https://onenav-workers.<你的子域>.workers.dev"
curl -s -o /dev/null -w "%{http_code}\n" "$URL/"            # 200，首页 HTML
curl -s -o /dev/null -w "%{http_code}\n" "$URL/admin/links" # 200，SPA 深链不 404
curl -s "$URL/api/public_nav" && echo                        # {"code":0,...}
curl -s -X POST "$URL/api/app_info" && echo                  # {"code":0,...}
```

浏览器完整走一遍 Task 18 Step 2 的清单（生产环境）。

- [ ] **Step 7: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/wrangler.toml
git commit -m "chore: production assets config with SPA fallback, deployment verified"
```

---

## Self-Review Checklist

**Spec coverage：**

- [x] §4 数据库 schema（6 张表全建）— Task 3
- [x] §5 图标抽象（icon_source 字段预留，R2 接口后续阶段）— Task 3
- [x] §6 API 端点（含 public_nav / session，游客可见性对齐 PHP）— Tasks 8-12
- [x] §7 鉴权（X-Token + HttpOnly cookie，服务端 Set-Cookie）— Tasks 8, 11, 12
- [x] §8 主题系统（目录即主题、自动发现、tokens 内联、组件懒加载）— Task 14
- [x] §10 部署（含 SPA 深链 fallback）— Task 19
- [x] §9 数据迁移 — Phase 3（明确排除）
- [x] `/click/:id`、`get_link_info`、图标输出、PWA — Phase 4（明确排除）

**Phase 1 MVP 范围：**
- [x] Worker 骨架 — Tasks 1-2
- [x] D1 schema — Task 3
- [x] 测试基建（vitest-pool-workers）— Task 4
- [x] 鉴权 — Tasks 8, 11
- [x] category/link CRUD + 游客可见性 — Tasks 9-10
- [x] 公开导航数据 — Task 10
- [x] React SPA 框架 — Tasks 13, 16
- [x] 一套主题（default2）+ 首页真实数据 — Tasks 14-15

**Placeholder scan：** 无 TBD / TODO / 「同 Task N」/ 悬空引用。唯一的 `REPLACE` 是 wrangler `database_id`，由 Task 19 Step 3 的命令输出替换（属正常部署流程）。

**Type consistency：**
- `md5(input): string`（同步）— Task 4 定义，Task 8/11 使用一致
- `authenticate(db, fallbackUsername, xtoken, cookieKey, ua): Promise<string | null>` — Task 8 定义，Task 12（session + 中间件）使用一致
- `addCategoryHandler(db, input: CategoryInput)` / `addLinkHandler(db, input: LinkInput)` — Task 9/10 定义，Task 12 调用匹配
- `categoryListHandler(db, page, limit, isAuthed)` / `linkListHandler(db, page, limit, isAuthed, categoryId?)` — Task 9/10 定义，Task 12 传参匹配
- `publicNavHandler(db)` 返回 `{ code, data: { site_title, site_subtitle, categories } }` — 与 Task 15 `NavData` 类型字段一致
- 前端 hooks（无 token 参数，cookie 鉴权）— Task 15 定义，Task 17 使用一致

**本计划相对初版修复的缺陷（2026-09-10 复审）：**
1. 测试基建由幻觉的 `environment: 'miniflare'` 改为官方 `@cloudflare/vitest-pool-workers` + `cloudflare:test`
2. 新增 `GET /api/public_nav` 公开端点 + Home 页真实数据（初版首页是硬编码空数据）
3. wrangler assets 补 `not_found_handling = "single-page-application"`（深链刷新 404）
4. 修复 router 语法错误（create_sk 路由缺括号）
5. Init 成功后跳 `/login` 而非 `/admin`（初版空 cookie 会被立即踢回登录页）
6. `addCategoryHandler` 捕获 UNIQUE 约束错误并转为 PHP 兼容文案
7. Task 1 即建 `workers/.gitignore`（防 node_modules 进 git）
8. Migration 补齐 `on_shares` / `on_clicks` 两张表（对齐 spec §4）
9. MD5 改用 `js-md5` 包（初版手写 120 行实现），RFC 1321 名称修正
10. vite.config 移除未安装的 `@tailwindcss/vite` import；补 `@` alias 与 tsconfig paths
11. handler 返回类型统一为纯对象，`Set-Cookie` 副作用收口在 router 层
12. API client 不再把 cookie 当 X-Token 发（admin SPA 走 cookie，X-Token 留给插件）
13. `users.username` 去掉重复的唯一索引
14. 脚手架命令改用 `--framework=hono` 并附交互/手写兜底
15. 登录 cookie 改为服务端 HttpOnly Set-Cookie（初版前端 `document.cookie` 违反 spec §7）
16. 列表端点支持游客访问（对齐 PHP 插件兼容行为），`/api/*` 未知方法返回 JSON 404 而非 SPA HTML

**未在 Phase 1（后续阶段计划）：**
- minima 主题 — Phase 2
- 主题配置（s_themes 持久化、PC/移动双主题）— Phase 2
- 数据迁移 JSON 导入导出 — Phase 3
- 图标上传 + `/api/icon/:id` — Phase 3
- `/click/:id` 跳转统计 — Phase 4
- `get_link_info` URL 抓取 — Phase 4
- PWA manifest — Phase 4
