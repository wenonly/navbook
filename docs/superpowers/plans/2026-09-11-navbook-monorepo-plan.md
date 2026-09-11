# NavBook Monorepo 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 workers 单仓库重构为根 workspace 多包并行结构（workers/web/themes/shared），主题升级为独立完整前端应用，动态路由伺服 + 后台一键切换，品牌切换为 navbook。

**Architecture:** 根 pnpm workspace 编排；workers 纯 API（run_worker_first 显式分流 `/`→当前主题、`/admin`→web 壳、`/api`→业务）；主题产物 = 独立 vite 项目 dist（manifest 由 aggregate 脚本聚合）；shared 包提供类型 + API client（契约层）；public_nav 会话感知实现公私分层。

**Tech Stack:** 既有栈（Hono + Drizzle + D1 + Vite 8 + React 19 + Tailwind 3）+ Playwright E2E。

**Spec:** `docs/superpowers/specs/2026-09-11-navbook-monorepo-theme-design.md`

**基线：** main 分支，105 测试全绿，生产 https://nav.wenonly.cn（D1 内已有 211 条书签，重构期间数据不动）。

**关键现状备忘（执行者必读）：**
- workspace 根目前在 `workers/`（`pnpm-workspace.yaml` 含 `.` + `web`）；web 在 `workers/web/`
- `workers/wrangler.toml`：`name = "onenav-workers"`、routes=nav.wenonly.cn、assets 三项（无 run_worker_first）、D1 binding=DB + migrations_dir
- `workers/src/router.ts`：18 端点 + SPA fallback（`app.all('*')` 里 `/api/*`→JSON 404，其余→`ASSETS.fetch` 带 `!c.env.ASSETS` 判空防护）
- `workers/web/`：React SPA，路由 `/`（Home+ThemeRenderer）/init/login/admin{categories,links,token,import-export}；`src/themes/`（loader+default2）；`scripts/inline-tokens.ts` + index.html 的 `<style id="theme-tokens">` 占位
- `workers/tests/`：105 测试；`router.test.ts` 的 `req()` 用 `createApp().request(path, init, testEnv)`，testEnv 是自构造对象（可加 fake ASSETS）
- workers 测试命令 `pnpm -C workers test`（pretest 自动 typecheck）；web 构建 `pnpm -C workers/web build`
- 品牌注意：本次不改 API 路径与 D1 schema（数据兼容零迁移），只改 wrangler name、version 字符串、文档措辞

---

## File Structure

```
navbook/
├── package.json                    # T1：根编排（build/dev/deploy/test）
├── pnpm-workspace.yaml             # T1
├── .gitignore                      # T1
├── public/favicon.svg              # T1（自 web/public 迁移）
├── scripts/aggregate.mjs           # T6：聚合 + manifest 生成 + 自检
├── README.md                       # T10
│
├── shared/
│   ├── package.json                # T2：@navbook/shared
│   └── src/index.ts                # T2：类型（含 private）+ createApiClient + ApiError
│
├── web/                            # T1 提升自 workers/web；T3 清理 + T4/T8 改造
│   ├── vite.config.ts              #   base '/admin/'，outDir 'dist'
│   └── src/（admin/login/init + T8 主题管理页）
│
├── themes/
│   ├── default2/                   # T3：独立主题项目
│   │   ├── package.json / vite.config.ts / tsconfig.json / index.html
│   │   ├── public/theme.json
│   │   └── src/{main.tsx, App.tsx, index.css}
│   └── minima/                     # T7：同构第二主题
│
└── workers/
    ├── package.json                # T1 瘦身（deploy 去掉 build 前缀）
    ├── wrangler.toml               # T1 公共资产/T5 assets 三项 + name（T10 才改 name）
    ├── src/handlers/public.ts      # T4：public_nav 会话感知 + private 标记
    ├── src/handlers/themes.ts      # T5：主题配置（manifest/active 读取 + set）
    ├── src/router.ts               # T5：伺服路由表 + 2 新端点
    └── tests/{public.test.ts, themes.test.ts, router.test.ts}
```

---

## Task 1: 根 workspace 搭建与结构大迁移

**Files:**
- Create: `package.json`、`pnpm-workspace.yaml`、`.gitignore`、`public/favicon.svg`（迁移）
- Delete: `workers/pnpm-workspace.yaml`
- Modify: `workers/package.json`（瘦身）、`workers/web/vite.config.ts`（暂只改 outDir 注释级细节，base 在 T3 改）

- [ ] **Step 1: git mv 大迁移（保持历史）**

```bash
cd /Users/taowen/project/navbook
git mv workers/web web
mkdir -p public themes
git mv web/public/favicon.svg public/favicon.svg
git rm workers/pnpm-workspace.yaml
```

- [ ] **Step 2: 根 workspace 三件套**

`pnpm-workspace.yaml`：

```yaml
packages:
  - workers
  - web
  - shared
  - themes/*
```

根 `package.json`：

```json
{
  "name": "navbook",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm --filter @navbook/theme-default2 --filter @navbook/theme-minima --filter web run build && node scripts/aggregate.mjs",
    "dev": "pnpm -C workers dev & pnpm -C web dev",
    "test": "pnpm -C workers test",
    "deploy": "pnpm run build && pnpm -C workers run deploy"
  }
}
```

（T1 时 themes/shared 包尚不存在，`--filter` 匹配不到会跳过并警告——`build` 脚本在 T6 才真正可用；本任务验证只跑 test。T3/T7 建包后自然生效。）

根 `.gitignore`：

```
node_modules/
dist/
.wrangler/
.dev.vars
*.log
.playwright-mcp/
```

- [ ] **Step 3: workers/package.json 瘦身**

`name` 改 `"@navbook/workers"`；scripts 调整为（deploy 去掉 build 前缀——构建编排归根；dev 保留 predev=cf-typegen）：

```json
{
  "scripts": {
    "predev": "pnpm cf-typegen",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "cf-typegen": "wrangler types --env-interface CloudflareBindings",
    "db:migrate:local": "wrangler d1 migrations apply onenav-db --local",
    "db:migrate:remote": "wrangler d1 migrations apply onenav-db --remote"
  }
}
```

- [ ] **Step 4: web 改为独立包 + 修构建配置**

`web/package.json` 的 `name` 改 `"web"`（保持无 scope，App 内部名）。`web/vite.config.ts`：outDir 从 `'../dist'` 改 `'dist'`（本包内），proxy 不变；**base 本任务先不动**（T3 统一改 `/admin/`，那时 web 还要删 Home）。dev proxy 端口不变。

- [ ] **Step 5: 根安装 + 全量验证**

```bash
cd /Users/taowen/project/navbook
pnpm install
pnpm -C workers test          # 105/105（workers 的 vitest cwd 锚定 __dirname，不受根上移影响）
pnpm -C web build             # 零错误（产物落 web/dist）
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: restructure to root workspace (workers/web/themes/shared layout)"
```

（末尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`，全文同。）

---

## Task 2: shared 契约包（类型 + API client）

**Files:**
- Create: `shared/package.json`、`shared/tsconfig.json`、`shared/src/index.ts`

- [ ] **Step 1: 建包**

`shared/package.json`：

```json
{
  "name": "@navbook/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

`shared/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: 契约内容** `shared/src/index.ts`：

```ts
// ---- 数据契约（public_nav 会话感知版；兼容承诺：只加字段不删不改语义）----

export interface NavLink {
  id: number;
  fid: number;
  title: string;
  url: string;
  description: string | null;
  font_icon: string | null;
  url_standby: string | null;
  private: boolean;
}
export interface NavCategory {
  id: number;
  name: string;
  font_icon: string | null;
  description: string | null;
  private: boolean;
  children: NavCategory[];
  links: NavLink[];
}
export interface NavData {
  site_title: string;
  site_subtitle: string;
  categories: NavCategory[];
}
export interface SessionInfo {
  username: string | null;
}

// ---- 主题清单（aggregate 生成的 manifest.json 条目）----

export interface ThemeManifestEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  minAppVersion: string;
}

// ---- 错误 ----

export class ApiError extends Error {
  constructor(public status: number, public code: number, msg: string) {
    super(msg);
    this.name = 'ApiError';
  }
}

// ---- API client（纯 fetch，同源零配置；401 默认跳登录）----

export interface ApiClientOptions {
  /** 401 时的行为；默认跳转 /admin/login?redirect=<当前路径>，传 false 关闭 */
  onUnauthorized?: ((err: ApiError) => void) | false;
}

export function createApiClient(_opts: ApiClientOptions = {}) {
  const handle401 = (err: ApiError) => {
    if (_opts.onUnauthorized === false) return;
    if (typeof _opts.onUnauthorized === 'function') { _opts.onUnauthorized(err); return; }
    const redirect = encodeURIComponent(location.pathname + location.search);
    location.href = `/admin/login?redirect=${redirect}`;
  };

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(path);   // 同源 cookie 自动携带
    const json = await res.json().catch(() => { throw new ApiError(res.status, -1, '响应不是 JSON'); });
    if (res.status === 401) {
      const err = new ApiError(401, json?.code ?? -1002, json?.msg ?? '未登录');
      handle401(err);
      throw err;
    }
    if (json && typeof json === 'object' && 'code' in json && json.code !== 0) {
      throw new ApiError(res.status, json.code, json.msg ?? `错误码 ${json.code}`);
    }
    return json as T;
  }

  return {
    publicNav: () => get<NavData>('/api/public_nav'),
    session: () => get<{ code: 0; data: SessionInfo }>('/api/session'),
    // 未来生长点：search(q) / articles() / themeConfig() ...
  };
}
```

- [ ] **Step 3: web 接入 shared（消类型双源）**

```bash
cd /Users/taowen/project/navbook
pnpm -C web add @navbook/shared --workspace
```

`web/src/types/nav.ts` 删除；全仓 grep `@/types/nav` 并替换为 `@navbook/shared`（涉及 App 路由外的 ThemeRenderer/Home/default2——它们在 T3 退役，本步只改**存活文件**：`api/client.ts` 若引用则改 import）。web 的 `api/hooks.ts` 里 `api.publicNav` 返回类型改为 `import('@navbook/shared').NavData` 形式（若原来是 `@/types/nav`）。

- [ ] **Step 4: 验证 + Commit**

```bash
pnpm -C web build && pnpm -C workers test   # 全绿（workers 不依赖 shared，无影响）
git add -A && git commit -m "feat: @navbook/shared contract package (types + api client)"
```

---

## Task 3: default2 独立主题项目 + web 壳清理

**Files:**
- Create: `themes/default2/{package.json, vite.config.ts, tsconfig.json, index.html, public/theme.json, src/main.tsx, src/App.tsx, src/index.css}`
- Delete: `web/src/themes/`（loader + default2）、`web/src/components/ThemeRenderer.tsx`、`web/src/routes/Home.tsx`、`web/scripts/inline-tokens.ts`
- Modify: `web/src/App.tsx`（删 Home 路由与 import）、`web/vite.config.ts`（base `/admin/`）、`web/index.html`（删 tokens 占位与预设脚本）、`web/package.json`（删 prebuild）

- [ ] **Step 1: 主题包骨架**

`themes/default2/package.json`：

```json
{
  "name": "@navbook/theme-default2",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@navbook/shared": "workspace:*",
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^6.1.1",
    "autoprefixer": "^10.5.6",
    "postcss": "^8.5.28",
    "tailwindcss": "^3.4.19",
    "typescript": "~6.0.3",
    "vite": "^8.3.0"
  }
}
```

（版本以 `web/package.json` 实装为准对齐——执行时读 web 的版本抄过来，保证 workspace 内一致。）

`themes/default2/vite.config.ts`：

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/themes/default2/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:8787' },
  },
});
```

`themes/default2/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "paths": {}
  },
  "include": ["src/**/*"]
}
```

`themes/default2/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="/favicon.svg" />
    <title>NavBook</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`themes/default2/public/theme.json`：

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

- [ ] **Step 2: 主题源码**（迁移自 `web/src/themes/default2/index.tsx` + tokens.css，独立化为完整应用）

`themes/default2/src/index.css`（tokens 并入，去掉 `:root[data-theme=...]` 选择器——主题自己就是唯一上下文；补 Tailwind 指令）：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-primary: #3b82f6;
  --color-primary-hover: #2563eb;
  --color-bg: #ffffff;
  --color-bg-subtle: #f9fafb;
  --color-text: #111827;
  --color-text-subtle: #6b7280;
  --color-border: #e5e7eb;
  --radius: 8px;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  font-family: system-ui, -apple-system, sans-serif;
}
:root[data-mode="dark"] {
  --color-bg: #1a1a1a;
  --color-bg-subtle: #222222;
  --color-text: #e5e5e5;
  --color-text-subtle: #9ca3af;
  --color-border: #333333;
}
```

（tailwind.config.js / postcss.config.js 从 web 拷贝，content 改 `['./index.html', './src/**/*.{ts,tsx}']`。）

`themes/default2/src/main.tsx`：

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createApiClient } from '@navbook/shared';
import type { NavData } from '@navbook/shared';
import App from './App';
import './index.css';

const api = createApiClient();
const root = ReactDOM.createRoot(document.getElementById('root')!);

type State =
  | { kind: 'loading' }
  | { kind: 'error'; msg: string }
  | { kind: 'ready'; data: NavData };

function Root() {
  const [state, setState] = React.useState<State>({ kind: 'loading' });

  const load = React.useCallback(() => {
    setState({ kind: 'loading' });
    api.publicNav()
      .then(data => setState({ kind: 'ready', data }))
      .catch(err => setState({ kind: 'error', msg: err instanceof Error ? err.message : '加载失败' }));
  }, []);

  React.useEffect(load, [load]);

  if (state.kind === 'loading') {
    return <div className="p-8" style={{ color: 'var(--color-text-subtle)' }}>加载中...</div>;
  }
  if (state.kind === 'error') {
    return (
      <div className="p-8">
        <p style={{ color: 'var(--color-text)' }}>{state.msg}</p>
        <button
          onClick={load}
          className="mt-2 px-4 py-1 rounded text-white"
          style={{ background: 'var(--color-primary)' }}
        >
          重试
        </button>
      </div>
    );
  }
  return <App data={state.data} />;
}

root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
```

`themes/default2/src/App.tsx`：以现 `web/src/themes/default2/index.tsx` 为基础迁移，改动三处——(a) import 类型改 `@navbook/shared`；(b) 所有分类/链接渲染处**新增私标**（见下）；(c) 分类标题旁若 `private` 显示小锁：

```tsx
import type { NavData, NavLink } from '@navbook/shared';

export default function App({ data }: { data: NavData }) {
  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold" style={{ color: 'var(--color-text)' }}>{data.site_title}</h1>
        {data.site_subtitle && (
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-subtle)' }}>{data.site_subtitle}</p>
        )}
      </header>
      <div className="space-y-10">
        {data.categories.map(cat => (
          <section key={cat.id}>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
              {cat.font_icon && <span className={cat.font_icon} aria-hidden />}
              {cat.name}
              {cat.private && <PrivateBadge />}
            </h2>
            {cat.links.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-4">
                {cat.links.map(link => <LinkCard key={link.id} link={link} />)}
              </div>
            )}
            {cat.children.map(sub => (
              <div key={sub.id} className="mb-4">
                <h3 className="text-sm font-medium mb-2 uppercase tracking-wide flex items-center gap-1"
                    style={{ color: 'var(--color-text-subtle)' }}>
                  {sub.font_icon && <span className={`${sub.font_icon} mr-1`} aria-hidden />}
                  {sub.name}
                  {sub.private && <PrivateBadge />}
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

function PrivateBadge() {
  return (
    <span
      title="私有（仅登录后可见）"
      className="text-xs px-1.5 py-0.5 rounded"
      style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-subtle)' }}
    >
      🔒
    </span>
  );
}

function LinkCard({ link }: { link: NavLink }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-3 transition hover:shadow-md relative"
      style={{
        backgroundColor: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        opacity: link.private ? 0.75 : 1,
      }}
    >
      {link.private && (
        <span className="absolute top-1.5 right-1.5 text-[10px]" title="私有">🔒</span>
      )}
      <div className="flex items-center gap-2 mb-1">
        {link.font_icon && <span className={link.font_icon} aria-hidden />}
        <span className="font-medium truncate text-sm" style={{ color: 'var(--color-text)' }}>{link.title}</span>
      </div>
      {link.description && (
        <p className="text-xs truncate" style={{ color: 'var(--color-text-subtle)' }}>{link.description}</p>
      )}
    </a>
  );
}
```

- [ ] **Step 3: web 壳清理**

```bash
cd /Users/taowen/project/navbook
git rm -r web/src/themes
git rm web/src/components/ThemeRenderer.tsx web/src/routes/Home.tsx web/scripts/inline-tokens.ts
```

`web/src/App.tsx`：删 Home 的 import 与 `<Route path="/" element={<Home />} />`，`path="*"` 兜底改 `<Navigate to="/admin" replace />`。`web/vite.config.ts`：`base: '/admin/'`。`web/index.html`：删 `<style id="theme-tokens">...</style>` 整块与后面的预设 data-theme 内联 `<script>`；`<title>` 改 `NavBook 管理`。`web/package.json`：删 `prebuild`。`web/src/api/hooks.ts`：删 `usePublicNav`（连同 `api.publicNav` 引用）；`web/src/api/client.ts` 里 publicNav 方法删除（session 保留——AdminLayout 在用）。

- [ ] **Step 4: 验证**

```bash
pnpm install
pnpm -C web build                        # 零错误
pnpm --filter @navbook/theme-default2 build   # 产物 dist/{theme.json,index.html,assets/*}
ls themes/default2/dist
pnpm -C workers test                     # 105/105（router 的 SPA fallback 测试不涉及删除的文件）
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: default2 as standalone theme app; web shell slimmed to admin"
```

---

## Task 4: public_nav 会话感知 + private 标记（TDD）

**Files:**
- Modify: `workers/src/handlers/public.ts`、`workers/src/router.ts`（public_nav 挂 optionalAuthMiddleware）
- Test: `workers/tests/handlers/public.test.ts`（更新+新增）

- [ ] **Step 1: 更新测试（先红）**

`tests/handlers/public.test.ts`：
- `publicNavHandler` 签名改 `(db, isAuthed)`——**所有既有用例**加第二参（游客用例传 `false`，保持原断言）。
- 新增（放在既有 describe 内）：

```ts
  it('管理员（isAuthed）返回全量含 private 标记', async () => {
    const pub = await addCategoryHandler(db(), catInput('公开'));
    const priv = await addCategoryHandler(db(), catInput('私密分类', 0, 1));
    await addLinkHandler(db(), { ...linkInput(pub.id, 'Pub', 'https://p.com'), property: 0 });
    await addLinkHandler(db(), { ...linkInput(priv.id, 'Priv', 'https://v.com'), property: 1 });

    const guest = await publicNavHandler(db(), false);
    expect(guest.data.categories.map(c => c.name)).toEqual(['公开']);

    const admin = await publicNavHandler(db(), true);
    const names = admin.data.categories.map(c => c.name);
    expect(names).toContain('公开');
    expect(names).toContain('私密分类');
    const privCat = admin.data.categories.find(c => c.name === '私有分类' ?? c.name === '私密分类')!;
    expect(privCat.private).toBe(true);
    expect(privCat.links[0].private).toBe(true);
    const pubCat = admin.data.categories.find(c => c.name === '公开')!;
    expect(pubCat.private).toBe(false);
    expect(pubCat.links[0].private).toBe(false);
  });
```

（注意上面 `find` 里写死一个名字——直接用 `c.name === '私密分类'`，删掉 `??` 的笔误形态。）

`tests/router.test.ts` 新增：

```ts
  it('public_nav 带 cookie 返回私有数据', async () => {
    await seedUser();
    // 用 X-Token 走 optionalAuth 通道（与 cookie 等价）
    await req('/api/add_category', { ...form({ name: '私有', property: '1' }), headers: { 'X-Token': validToken() } });
    const guest = await (await req('/api/public_nav')).json() as any;
    expect(guest.data.categories).toEqual([]);
    const admin = await (await req('/api/public_nav', { headers: { 'X-Token': validToken() } })).json() as any;
    expect(admin.data.categories[0].private).toBe(true);
  });
```

跑 `pnpm -C workers exec vitest run tests/handlers/public.test.ts tests/router.test.ts` 记录红灯。

- [ ] **Step 2: 实现**

`handlers/public.ts`：`publicNavHandler(db: DB, isAuthed: boolean)`——分类查询去掉 `where(property=0)`（isAuthed 时），链接查询条件改为 `isAuthed ? inArray(fid, catIds) : and(property=0, inArray(fid, catIds))`；组装节点/链接时带 `private: <行 property> === 1`（分类与链接 select 均补 property 列）。类型导出改用本地接口（workers 不依赖 shared；形状与 shared 契约一致——**注释注明**"与 @navbook/shared 的 NavData 契约对齐，只加字段不删"）。

`router.ts`：`app.get('/api/public_nav', optionalAuthMiddleware, async c => c.json(await publicNavHandler(c.get('db'), c.get('isAuthed'))));`

- [ ] **Step 3: 绿灯 + Commit**

```bash
pnpm -C workers test      # 全绿（~107）
git add -A && git commit -m "feat: session-aware public_nav with private flags (spec §4)"
```

---

## Task 5: 主题伺服路由 + 配置 API（TDD）

**Files:**
- Create: `workers/src/handlers/themes.ts`
- Modify: `workers/src/router.ts`（路由表重写 + 2 端点）、`workers/wrangler.toml`（assets 三项）
- Test: `workers/tests/themes.test.ts`（新）、`workers/tests/router.test.ts`（更新 SPA fallback 断言 + 新增）

- [ ] **Step 1: wrangler.toml assets 改造**

```toml
[assets]
directory = "./dist"
binding = "ASSETS"
run_worker_first = true
html_handling = "none"
not_found_handling = "none"
```

- [ ] **Step 2: 写失败测试**

`tests/themes.test.ts`（新建）：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { getActiveTheme, setActiveTheme, mergeManifest } from '../../src/handlers/themes';
import { resetTables, seedUser } from '../helpers';

beforeEach(async () => {
  await resetTables();
});

const db = () => getDb(env.DB);

describe('主题配置', () => {
  it('active 缺省为 default2', async () => {
    expect(await getActiveTheme(db())).toBe('default2');
  });

  it('set 后生效且可覆盖', async () => {
    await setActiveTheme(db(), 'minima');
    expect(await getActiveTheme(db())).toBe('minima');
    await setActiveTheme(db(), 'default2');
    expect(await getActiveTheme(db())).toBe('default2');
  });

  it('manifest 合并：D1 覆盖段优先，按 id 去重', async () => {
    const assetsManifest = [
      { id: 'default2', name: 'Default 2', version: '1', author: 'a', description: '', minAppVersion: '1' },
    ];
    const d1Manifest = [
      { id: 'uploaded-theme', name: 'U', version: '2', author: 'b', description: '', minAppVersion: '1' },
      { id: 'default2', name: 'D1 覆盖版', version: '9', author: 'b', description: '', minAppVersion: '1' },
    ];
    const merged = mergeManifest(d1Manifest, assetsManifest);
    expect(merged.map(t => t.id).sort()).toEqual(['default2', 'uploaded-theme']);
    expect(merged.find(t => t.id === 'default2')!.name).toBe('D1 覆盖版');  // D1 优先
  });
});
```

`tests/router.test.ts` 更新 + 新增（`req()` 旁加 fake ASSETS 注入）：

```ts
// 文件顶部：fake ASSETS（html 按路径返回标记内容，资源 200）
function makeFakeAssets() {
  const files = new Map<string, string>([
    ['/admin/index.html', '<html>ADMIN_SHELL</html>'],
    ['/themes/manifest.json', JSON.stringify([
      { id: 'default2', name: 'Default 2', version: '1.0.0', author: 't', description: '', minAppVersion: '1.0.0' },
      { id: 'minima', name: 'Minima', version: '1.0.0', author: 't', description: '', minAppVersion: '1.0.0' },
    ])],
    ['/themes/default2/index.html', '<html>THEME_DEFAULT2</html>'],
    ['/themes/minima/index.html', '<html>THEME_MINIMA</html>'],
    ['/themes/default2/assets/app.js', 'console.log(1)'],
    ['/favicon.svg', '<svg/>'],
  ]);
  return {
    fetch: (req: Request) => {
      const path = new URL(req.url).pathname;
      const body = files.get(path);
      const type = path.endsWith('.json') ? 'application/json'
        : path.endsWith('.html') ? 'text/html'
        : path.endsWith('.svg') ? 'image/svg+xml' : 'application/javascript';
      return Promise.resolve(new Response(body ?? null, { status: body ? 200 : 404, headers: { 'Content-Type': type } }));
    },
  } as unknown as Fetcher;
}
// testEnv 构造处改为：{ ...env, ASSETS: makeFakeAssets() } as unknown as ...
```

新增用例（describe 内）：

```ts
  it('/ 返回当前主题 HTML（缺省 default2）', async () => {
    const res = await req('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('THEME_DEFAULT2');
  });

  it('set_theme 切换后 / 即刻返回新主题（需鉴权）', async () => {
    await seedUser();
    const noAuth = await req('/api/set_theme', form({ theme: 'minima' }));
    expect(noAuth.status).toBe(401);

    await req('/api/set_theme', { ...form({ theme: 'minima' }), headers: { 'X-Token': validToken() } });
    const home = await req('/');
    expect(await home.text()).toContain('THEME_MINIMA');
  });

  it('set_theme 校验 manifest，未知主题拒绝', async () => {
    await seedUser();
    const res = await req('/api/set_theme', { ...form({ theme: 'nope' }), headers: { 'X-Token': validToken() } });
    const json = await res.json() as any;
    expect(json.code).not.toBe(0);
  });

  it('GET /api/themes 返回 active + 列表（需鉴权）', async () => {
    await seedUser();
    expect((await req('/api/themes')).status).toBe(401);
    const res = await req('/api/themes', { headers: { 'X-Token': validToken() } });
    const json = await res.json() as any;
    expect(json.data.active).toBe('default2');
    expect(json.data.themes.map((t: any) => t.id)).toContain('minima');
  });

  it('/admin 深链 404 回落 admin SPA', async () => {
    const res = await req('/admin/links');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('ADMIN_SHELL');
  });

  it('主题资产直出 + 未知路径 302 /', async () => {
    expect((await req('/themes/default2/assets/app.js')).status).toBe(200);
    const unknown = await req('/whatever');
    expect(unknown.status).toBe(302);
    expect(unknown.headers.get('Location')).toBe('/');
  });

  it('主题产物缺失回落链：配置的主题没有产物 → default2', async () => {
    await seedUser();
    // minima 在 manifest 但 fake assets 删掉其 index.html 的场景由下一用例覆盖；
    // 这里测 active=不存在的主题（绕过 set 校验直接写库）
    await env.DB.prepare("INSERT OR REPLACE INTO on_options (key, value) VALUES ('s_themes', ?)")
      .bind('{"active":"ghost"}').run();
    const res = await req('/');
    expect(await res.text()).toContain('THEME_DEFAULT2');
  });
```

（既有 SPA fallback 相关断言若因路由重写失效，按新行为更新。跑测试记录红灯。）

- [ ] **Step 3: 实现 `handlers/themes.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';

export const DEFAULT_THEME = 'default2';

export interface ThemeManifestEntry {
  id: string; name: string; version: string;
  author: string; description: string; minAppVersion: string;
}

/** s_themes.active：缺省 default2（代码常量，无需部署时写库） */
export async function getActiveTheme(db: DB): Promise<string> {
  const row = await db.select().from(schema.options).where(eq(schema.options.key, 's_themes')).get();
  if (!row?.value) return DEFAULT_THEME;
  try {
    const parsed = JSON.parse(row.value);
    return typeof parsed?.active === 'string' && parsed.active ? parsed.active : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export async function setActiveTheme(db: DB, theme: string): Promise<void> {
  const value = JSON.stringify({ active: theme });
  const existing = await db.select().from(schema.options).where(eq(schema.options.key, 's_themes')).get();
  if (existing) {
    await db.update(schema.options).set({ value }).where(eq(schema.options.key, 's_themes'));
  } else {
    await db.insert(schema.options).values({ key: 's_themes', value });
  }
}

/** manifest 合并：D1 覆盖段（未来 R2 上传）优先于 assets 段，按 id 去重 */
export function mergeManifest(d1: ThemeManifestEntry[], assets: ThemeManifestEntry[]): ThemeManifestEntry[] {
  const byId = new Map<string, ThemeManifestEntry>();
  for (const t of assets) byId.set(t.id, t);
  for (const t of d1) byId.set(t.id, t);   // D1 后写覆盖
  return [...byId.values()];
}
```

- [ ] **Step 4: 实现 router 伺服路由（替换现有 `app.all('*')` 段，加在全部 API 路由之后）**

```ts
import { getActiveTheme, setActiveTheme, mergeManifest, DEFAULT_THEME } from './handlers/themes';
import type { ThemeManifestEntry } from './handlers/themes';

// ---------- 主题配置 API ----------

async function fetchAssetsJson(c: any, path: string): Promise<unknown | null> {
  const res = await c.env.ASSETS.fetch(new Request(new URL(path, c.req.url)));
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

app.get('/api/themes', authMiddleware, async c => {
  const d1Manifest = await fetchAssetsJson(c, '/themes/manifest.d1.json');  // 未来 R2 段先留路径，当前不存在返回 null
  const assetsManifest = (await fetchAssetsJson(c, '/themes/manifest.json')) as ThemeManifestEntry[] | null;
  return c.json({
    code: 0,
    data: {
      active: await getActiveTheme(c.get('db')),
      themes: mergeManifest(
        Array.isArray(d1Manifest) ? d1Manifest as ThemeManifestEntry[] : [],
        Array.isArray(assetsManifest) ? assetsManifest : [],
      ),
    },
  });
});

app.post('/api/set_theme', authMiddleware, async c => {
  const body = await parseBody(c);
  const theme = String(body.theme ?? '');
  if (!theme) return c.json({ code: -2000, msg: 'theme 不能为空' });
  const assetsManifest = (await fetchAssetsJson(c, '/themes/manifest.json')) as ThemeManifestEntry[] | null;
  const d1Manifest = (await fetchAssetsJson(c, '/themes/manifest.d1.json')) as ThemeManifestEntry[] | null;
  const known = new Set(mergeManifest(
    Array.isArray(d1Manifest) ? d1Manifest : [],
    Array.isArray(assetsManifest) ? assetsManifest : [],
  ).map(t => t.id));
  if (!known.has(theme)) return c.json({ code: -2000, msg: `未知主题：${theme}` });
  await setActiveTheme(c.get('db'), theme);
  return c.json({ code: 0, data: { active: theme } });
});

// ---------- 伺服路由（放最后） ----------

function assetReq(c: any, path: string): Request {
  return new Request(new URL(path, c.req.url));
}

app.all('*', async c => {
  const path = c.req.path;

  // API 未知方法：JSON 404（既有行为）
  if (path.startsWith('/api/')) {
    return c.json({ code: -404, msg: 'method not found!' }, 404);
  }

  if (!c.env.ASSETS) {
    return c.text('assets not configured (build first: pnpm build)', 500);
  }

  // 主题资产 / 根公共资产：直出
  if (path.startsWith('/themes/') || path === '/favicon.svg' || path === '/favicon.ico' || path === '/robots.txt') {
    return c.env.ASSETS.fetch(assetReq(c, path));
  }

  // 管理壳：直出，404 回落 SPA index（深链）
  if (path === '/admin' || path.startsWith('/admin/') || path === '/login' || path === '/init') {
    const res = await c.env.ASSETS.fetch(assetReq(c, path));
    if (res.status !== 404) return res;
    return c.env.ASSETS.fetch(assetReq(c, '/admin/index.html'));
  }

  // 首页：当前主题
  if (path === '/') {
    const manifest = await fetchAssetsJson(c, '/themes/manifest.json') as ThemeManifestEntry[] | null;
    const ids = new Set((manifest ?? []).map(t => t.id));
    let active = await getActiveTheme(c.get('db'));
    if (!ids.has(active)) {
      console.warn(`theme "${active}" not in manifest, falling back to ${DEFAULT_THEME}`);
      active = DEFAULT_THEME;
    }
    if (ids.size > 0 || active === DEFAULT_THEME) {
      const res = await c.env.ASSETS.fetch(assetReq(c, `/themes/${active}/index.html`));
      if (res.status !== 404) return res;
      console.warn(`theme "${active}" entry missing, falling back to ${DEFAULT_THEME}`);
      if (active !== DEFAULT_THEME) {
        const fb = await c.env.ASSETS.fetch(assetReq(c, `/themes/${DEFAULT_THEME}/index.html`));
        if (fb.status !== 404) return fb;
      }
    }
    return c.redirect('/', 302).redirect; // 防自环：default2 也缺 → 转 /admin
  }

  return c.redirect('/', 302);
});
```

**注意（执行者必须处理的两处）**：
1. `/` 的最终兜底不能 302 到 `/`（自环）——上面伪码最后是错的。正确写法：default2 产物也缺失时 `return Response.redirect(new URL('/admin', c.req.url), 302)`（直接构造 Response，不经 hono 的 c.redirect 链式陷阱）。用 `return new Response(null, { status: 302, headers: { Location: '/admin' } })`。
2. Hono 无 `c.redirect(...).redirect` 这种链式——未知路径直接 `return new Response(null, { status: 302, headers: { Location: '/' } })`。

- [ ] **Step 5: 绿灯 + Commit**

```bash
pnpm -C workers test      # 全绿（~115）
git add -A && git commit -m "feat: worker-first theme routing + /api/themes + /api/set_theme (TDD)"
```

---

## Task 6: aggregate 聚合脚本 + 根构建链

**Files:**
- Create: `scripts/aggregate.mjs`

- [ ] **Step 1: 实现**

```js
#!/usr/bin/env node
/**
 * 聚合构建产物到 workers/dist/：
 *   web/dist            → workers/dist/admin/
 *   themes/*/dist       → workers/dist/themes/<id>/
 *   public/*            → workers/dist/（根级）
 *   扫描 themes/*/dist/theme.json → workers/dist/themes/manifest.json
 * 末尾自检关键产物，缺失即非零退出（防半产物部署）。
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('.', import.meta.url)));
const out = join(root, 'workers', 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// web → admin/
cpSync(join(root, 'web', 'dist'), join(out, 'admin'), { recursive: true });

// 根公共资产
cpSync(join(root, 'public'), out, { recursive: true });

// themes → themes/<id>/ + manifest
const themesDir = join(root, 'themes');
const manifest = [];
for (const entry of readdirSync(themesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dist = join(themesDir, entry.name, 'dist');
  const themeJson = join(dist, 'theme.json');
  if (!existsSync(themeJson)) {
    console.warn(`⚠ themes/${entry.name} 无 dist/theme.json，跳过（先构建）`);
    continue;
  }
  cpSync(dist, join(out, 'themes', entry.name), { recursive: true });
  manifest.push(JSON.parse(readFileSync(themeJson, 'utf8')));
}
writeFileSync(join(out, 'themes', 'manifest.json'), JSON.stringify(manifest, null, 2));

// 自检
const checks = [
  join(out, 'admin', 'index.html'),
  join(out, 'themes', 'manifest.json'),
  join(out, 'favicon.svg'),
];
for (const t of manifest) checks.push(join(out, 'themes', t.id, 'index.html'));
const missing = checks.filter(p => !existsSync(p));
if (missing.length) {
  console.error(`✘ 聚合自检失败，缺：${missing.join(', ')}`);
  process.exit(1);
}
console.log(`✓ 聚合完成：admin + ${manifest.length} 主题（${manifest.map(t => t.id).join(', ')}）→ workers/dist`);
```

- [ ] **Step 2: 全链路构建验证**

```bash
cd /Users/taowen/project/navbook
pnpm build
# 期望：两个主题构建 + web 构建零错误，末行 "✓ 聚合完成：admin + 2 主题（default2, minima→T7 前是 default2）..."
ls workers/dist workers/dist/themes
cat workers/dist/themes/manifest.json
```

（T7 前 manifest 只有 default2，正常。）

- [ ] **Step 3: 本地伺服冒烟（wrangler dev 走新路由）**

```bash
pnpm -C workers dev &
sleep 8
curl -s http://localhost:8787/ | head -3                  # 主题 HTML（default2）
curl -s http://localhost:8787/admin/ | head -3            # ADMIN 壳
curl -s http://localhost:8787/api/public_nav | head -c 120
pkill -f wrangler || true
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: aggregate build pipeline (web+themes+manifest, self-checking)"
```

---

## Task 7: minima 主题（紧凑列表风）

**Files:**
- Create: `themes/minima/`（与 default2 同构：package.json / vite.config.ts / tsconfig.json / index.html / public/theme.json / tailwind+postcss 配置 / src/{main.tsx, App.tsx, index.css}）

- [ ] **Step 1: 复制骨架改名**

```bash
cd /Users/taowen/project/navbook
cp -r themes/default2 themes/minima
```

改四处：`package.json` name → `@navbook/theme-minima`；`vite.config.ts` base → `'/themes/minima/'`、port → `5175`；`public/theme.json`：

```json
{
  "id": "minima",
  "name": "Minima",
  "version": "1.0.0",
  "author": "taowen",
  "description": "紧凑列表导航主题",
  "minAppVersion": "1.0.0"
}
```

`src/main.tsx` 原样（App 引用不变）。

- [ ] **Step 2: minima 的 App.tsx（紧凑列表风，与 default2 视觉差异明显）**

```tsx
import type { NavData, NavLink } from '@navbook/shared';

export default function App({ data }: { data: NavData }) {
  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <header className="mb-10 pb-6" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--color-text)' }}>
          {data.site_title}
        </h1>
        {data.site_subtitle && (
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-subtle)' }}>{data.site_subtitle}</p>
        )}
      </header>
      <nav>
        {data.categories.map(cat => (
          <section key={cat.id} className="mb-10">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-1.5"
                style={{ color: 'var(--color-text-subtle)' }}>
              {cat.font_icon && <span className={cat.font_icon} aria-hidden />}
              {cat.name}
              {cat.private && <span title="私有">🔒</span>}
            </h2>
            <ul>
              {cat.links.map(l => <Row key={l.id} link={l} indent={false} />)}
              {cat.children.map(sub => (
                <li key={sub.id}>
                  <div className="text-xs font-medium mt-4 mb-1 pl-2 flex items-center gap-1"
                       style={{ color: 'var(--color-text-subtle)' }}>
                    {sub.name}
                    {sub.private && <span title="私有">🔒</span>}
                  </div>
                  <ul>{sub.links.map(l => <Row key={l.id} link={l} indent />)}</ul>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </main>
  );
}

function Row({ link, indent }: { link: NavLink; indent: boolean }) {
  return (
    <li className={indent ? 'pl-6' : ''}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-baseline justify-between py-2 px-2 -mx-2 rounded hover:bg-[var(--color-bg-subtle)]"
        style={{ color: 'var(--color-text)', opacity: link.private ? 0.7 : 1 }}
      >
        <span className="flex items-baseline gap-2 min-w-0">
          {link.font_icon && <span className={`${link.font_icon} text-sm`} aria-hidden />}
          <span className="truncate text-sm font-medium">{link.title}</span>
          {link.private && <span className="text-[10px]" title="私有">🔒</span>}
        </span>
        <span className="hidden sm:block truncate text-xs max-w-[40%]" style={{ color: 'var(--color-text-subtle)' }}>
          {new URL(link.url).hostname}
        </span>
      </a>
    </li>
  );
}
```

`src/index.css`：Tailwind 三指令 + 差异化 tokens（圆角 2px、字体偏窄、留白更大）：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-primary: #2563eb;
  --color-bg: #fafafa;
  --color-bg-subtle: #f0f0f0;
  --color-text: #18181b;
  --color-text-subtle: #71717a;
  --color-border: #e4e4e7;
  --radius: 2px;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
:root[data-mode="dark"] {
  --color-bg: #111111;
  --color-bg-subtle: #1c1c1c;
  --color-text: #f4f4f5;
  --color-text-subtle: #a1a1aa;
  --color-border: #27272a;
}
```

（`new URL(link.url).hostname` 可能因非常规 URL 抛错——包 try/catch 降级为空串：`safeHost(link.url)` 小函数。）

- [ ] **Step 3: 构建验证 + Commit**

```bash
pnpm build    # manifest 应出现两个主题；聚合自检过
git add -A && git commit -m "feat: minima theme (compact list style)"
```

---

## Task 8: web 后台主题管理页

**Files:**
- Create: `web/src/routes/Admin/Theme.tsx`
- Modify: `web/src/App.tsx`（+路由）、`web/src/routes/Admin/Layout.tsx`（+侧边栏）、`web/src/api/client.ts`（+2 方法）

- [ ] **Step 1: client 追加**

`web/src/api/client.ts` 的 api 对象加：

```ts
  themes: () => get('/api/themes'),
  setTheme: (theme: string) => post('set_theme', { theme }),
```

- [ ] **Step 2: 主题管理页**（卡片列表 + 当前高亮 + 一键切换）

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

interface ThemeEntry {
  id: string; name: string; version: string;
  author: string; description: string;
}

export function AdminTheme() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['themes'], queryFn: api.themes });
  const [error, setError] = useState('');

  const switchTheme = useMutation({
    mutationFn: (id: string) => api.setTheme(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['themes'] }),
  });

  if (isLoading) return <div>加载中...</div>;
  if (isError || !data?.data) return <div>加载失败，请刷新重试</div>;

  const { active, themes } = data.data as { active: string; themes: ThemeEntry[] };

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>主题管理</h2>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-subtle)' }}>
        当前主题：<strong>{active}</strong>——切换即时生效（首页刷新可见）。
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {themes.map(t => (
          <div
            key={t.id}
            className="p-4 border rounded"
            style={{
              borderColor: t.id === active ? 'var(--color-primary)' : 'var(--color-border)',
              borderWidth: t.id === active ? 2 : 1,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium" style={{ color: 'var(--color-text)' }}>{t.name}</h3>
              <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>v{t.version}</span>
            </div>
            <p className="text-xs mb-1" style={{ color: 'var(--color-text-subtle)' }}>{t.description || '—'}</p>
            <p className="text-xs mb-3" style={{ color: 'var(--color-text-subtle)' }}>by {t.author}</p>
            <button
              type="button"
              disabled={t.id === active || switchTheme.isPending}
              onClick={() => {
                setError('');
                switchTheme.mutate(t.id, { onError: (e: Error) => setError(e.message) });
              }}
              className="px-3 py-1 rounded text-sm text-white disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              {t.id === active ? '当前主题' : '启用'}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
      <p className="text-xs mt-6" style={{ color: 'var(--color-text-subtle)' }}>
        <a href="/" target="_blank" style={{ color: 'var(--color-primary)' }}>查看首页 ↗</a>
      </p>
    </div>
  );
}
```

（顶部 `import { useState } from 'react';` 补上。）

- [ ] **Step 3: 接线**：App.tsx 加 `<Route path="theme" element={<AdminTheme />} />` + import；Layout 侧边栏「导入导出」后加「主题管理」NavLink（to `/admin/theme`，同既有模式）。

- [ ] **Step 4: 构建 + Commit**

```bash
pnpm -C web build
git add -A && git commit -m "feat(web): theme management page (cards + instant switch)"
```

---

## Task 9: 本地端到端验证（Playwright）

**Files:** 无（纯验证；发现 bug 记录并回修，不自行大改）

- [ ] **Step 1: 起全栈 + 数据准备**

```bash
cd /Users/taowen/project/navbook
rm -rf workers/.wrangler/state/v3/d1 && pnpm -C workers db:migrate:local
pnpm build
(pnpm -C workers dev > /tmp/nb-api.log 2>&1 &)
sleep 8
curl -s -X POST http://localhost:8787/api/init -d "username=admin&password=test123" > /tmp/nb-init.json
SK=$(python3 -c "import json;print(json.load(open('/tmp/nb-init.json'))['data']['secret_key'])")
TOKEN=$(python3 -c "import hashlib;print(hashlib.md5(('admin'+'$SK').encode()).hexdigest())")
# 造数据：一个公开分类（带公开+私有链接）、一个私有分类
curl -s -X POST http://localhost:8787/api/add_category -H "X-Token: $TOKEN" -d "name=公开分类" >/dev/null
curl -s -X POST http://localhost:8787/api/add_category -H "X-Token: $TOKEN" -d "name=私有分类&property=1" >/dev/null
curl -s -X POST http://localhost:8787/api/add_link -H "X-Token: $TOKEN" -d "fid=1&title=GitHub&url=https://github.com" >/dev/null
curl -s -X POST http://localhost:8787/api/add_link -H "X-Token: $TOKEN" -d "fid=1&title=内部工具&url=https://in.example.com&property=1" >/dev/null
curl -s -X POST http://localhost:8787/api/add_link -H "X-Token: $TOKEN" -d "fid=2&title=私密链接&url=https://p.example.com" >/dev/null
```

- [ ] **Step 2: API 层走查（curl 清单，每项 ✅/❌）**

```bash
curl -s http://localhost:8787/ | grep -o 'themes/default2/assets/[^"]*' | head -1   # 主题 HTML 引用 /themes/ 前缀资产
curl -s http://localhost:8787/api/public_nav                                          # 游客：只见"公开分类"+GitHub
curl -s -H "X-Token: $TOKEN" http://localhost:8787/api/public_nav                     # 管理员：全量 + private:true
curl -s -H "X-Token: $TOKEN" -X POST http://localhost:8787/api/set_theme -d "theme=minima"
curl -s http://localhost:8787/                                                        # 切换后 minima HTML
curl -s -H "X-Token: $TOKEN" http://localhost:8787/api/themes                         # active:minima
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/admin/links            # 200（SPA 深链）
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/whatever               # 302
```

- [ ] **Step 3: 浏览器走查（playwright 工具）**

1. `http://localhost:8787/` → minima 紧凑列表渲染；游客看不到「私有分类」和「内部工具」「私密链接」
2. `/admin/login` 输 test123 → `/admin`；侧边栏出现「主题管理」
3. 主题管理页：两张卡片（Default 2 / Minima），当前 Minima 高亮；点「启用」Default 2 → 高亮切换
4. 回 `/`（刷新）→ default2 卡片网格
5. （管理员 cookie 仍在）`/` 上「私有分类」可见且带 🔒、私有链接半透明带锁
6. /admin/links、/admin/categories、/admin/token、/admin/import-export 四页正常
7. console 无红色错误

- [ ] **Step 4: 清理**

```bash
pkill -f wrangler || true
rm -rf workers/.wrangler/state/v3/d1    # 重置本地库（生产数据不受影响）
git status --short                        # 干净
```

- [ ] **Step 5: Commit（如有回修）**——按实际回修内容提交。

---

## Task 10: 品牌切换与生产部署迁移

**Files:**
- Modify: `workers/wrangler.toml`（name=navbook）、`workers/src/handlers/auth.ts`（app_info version 品牌串）、`README.md`（新建）

- [ ] **Step 1: 品牌与 README**

`workers/wrangler.toml`：`name = "navbook"`（routes/database 不动）。
`workers/src/handlers/auth.ts` 的 `appInfoHandler`：`version: '1.0.0'` 前加注释、返回值保持（version 字符串改 `'2.0.0'`——monorepo 里程碑版本）。
根 `README.md`：

```markdown
# NavBook

跑在 Cloudflare Workers 上的书签导航站（OneNav 的 Workers 重构版）。API 兼容 OneNav 浏览器插件（X-Token）。

## 结构

- `workers/` — API（Hono + D1 + Drizzle），并按配置路由首页到当前主题
- `web/` — 管理后台 SPA（/admin）
- `themes/` — 独立主题项目（产物即分发单元）
- `shared/` — 类型与 API client 契约包

## 开发

    pnpm install
    pnpm dev                        # wrangler(8787) + web(5173)
    pnpm --filter @navbook/theme-default2 dev   # 单主题热更(5174)
    pnpm test

## 部署

    pnpm deploy                     # 构建 + 聚合 + wrangler deploy

首次部署需：`wrangler d1 create` + `wrangler d1 migrations apply onenav-db --remote` + routes 配置自定义域名。
数据迁移：旧 OneNav 导出 JSON → 后台「导入导出」页导入（详见 docs/）。
```

- [ ] **Step 2: 切换前备份（生产数据保险）**

用现有生产后台导一份 JSON（或告知用户自行导出）。最低限度：记录 `wrangler d1 export onenav-db --remote --output=/tmp/navbook-pre-restructure.sql`（wrangler 4 支持 d1 export；若命令不可用则跳过并告知用户手动导出 JSON）。

- [ ] **Step 3: 三步域名迁移（低峰执行）**

```bash
cd /Users/taowen/project/navbook
pnpm -C workers test && pnpm build         # 全绿再动

# 3a. 暂注释 routes 部署 navbook（占 workers.dev 验证）
#     wrangler.toml 暂时注释 routes 两行 → pnpm deploy
#     curl https://navbook.<子域>.workers.dev/api/public_nav 验证（本机若可达 workers.dev）
pnpm deploy

# 3b. 删除旧 worker（域名解绑）
pnpm -C workers exec wrangler delete --name onenav-workers
#     （若 --name 不被支持：临时把 wrangler.toml name 改回 onenav-workers 跑 wrangler delete 后再改回 navbook）

# 3c. 恢复 routes，重绑域名
#     取消注释 routes → pnpm deploy
pnpm deploy
```

- [ ] **Step 4: 生产全链路验证**

```bash
URL=https://nav.wenonly.cn
curl -s -o /dev/null -w "首页: %{http_code}\n" "$URL/"                       # 200 主题 HTML（含已迁移书签）
curl -s "$URL/" | grep -c "themes/"                                          # ≥1（/themes/ 前缀资产）
curl -s -o /dev/null -w "admin 深链: %{http_code}\n" "$URL/admin/links"      # 200
curl -s "$URL/api/public_nav" | head -c 150                                  # 211 条书签的公开数据仍在（D1 未动）
curl -s -X POST "$URL/api/app_info"                                          # version 2.0.0
```

浏览器走查同 Task 9 Step 3（生产版）：两主题切换、admin 全功能、私可见性。

- [ ] **Step 5: 最终 Commit**

```bash
git add -A && git commit -m "feat: rebrand to navbook, production migration complete"
git log --oneline -1
```

---

## Self-Review Checklist

**Spec 覆盖：**
- [x] §2 结构（根 workspace/三包/public/scripts）— T1/T6
- [x] §3 主题契约（产物形状/theme.json 无 api 字段/私标必须可区分）— T3/T7
- [x] §4 会话感知 public_nav + private 标记 + 401 语义 — T4（401 client 语义在 T2 shared）
- [x] §5 shared（类型+client+ApiError+onUnauthorized）— T2
- [x] §6 路由表/降级链/manifest D1 覆盖预留/themes+set_theme — T5
- [x] §7 主题开发体验（单主题 dev）— T3 vite 配置（T9 验证）
- [x] §8 根脚本/聚合自检/品牌三步迁移 — T1/T6/T10
- [x] §9 迁移映射 — T1/T3
- [x] §10 测试（后端新增/构建自检/E2E）— T4/T5/T6/T9
- [x] README — T10

**Placeholder scan：** 无 TBD；T5 Step 4 内嵌了两处"执行者必须处理"的更正说明（redirect 写法），这是给执行者的防错指令而非占位。

**Type consistency：** `getActiveTheme(db)/setActiveTheme(db, theme)/mergeManifest(d1, assets)` 在 T5 定义与测试一致；`ThemeManifestEntry` 六字段在 T2（shared）与 T5（workers 本地）形状一致；`publicNavHandler(db, isAuthed)` T4 定义、T5 路由传参一致；`@navbook/theme-default2|minima` 包名在 T1 根 build 脚本与 T3/T7 package.json 一致。

**风险已入计划：** redirect 自环防错（T5）、ASSETS 缺失防护（T5 500 提示）、聚合自检防半产物（T6）、切换前备份（T10 Step 2）、低峰三步迁移（T10 Step 3）。

