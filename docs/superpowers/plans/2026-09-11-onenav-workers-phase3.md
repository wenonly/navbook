# OneNav Workers Phase 3 (数据迁移) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现与 PHP 版 OneNav `export_json` 格式完全互通的书签导出/导入，让用户把存量 PHP 站点数据一键迁移到 Workers 版。

**Architecture:** 后端两个 handler（`migrate.ts`：export 构建嵌套树 + html_entity_decode；import 按"分类名复用 + URL 去重"合并导入，db.batch 分块插入）。格式定义与编解码集中在 `lib/legacy-format.ts` 单一事实源。前端后台新增「导入导出」页。

**Tech Stack:** 既有栈（Hono + Drizzle + D1 + Zod + React 19）。

**Spec:** `docs/superpowers/specs/2026-09-10-onenav-workers-design.md` §9（已按 PHP 真实格式修订）

**PHP 原版参考（已实测确认）:** `onenav/class/Api.php:829-976`（export_json）——嵌套树、`backup_url`/`sort_order` 字段名、导出解码实体、孤儿分类并入「默认分类」、导出不含 property/font_icon。

**现状基线:** main 分支，76 测试全绿，已部署 https://nav.wenonly.cn。测试基建 `@cloudflare/vitest-pool-workers`（`import { env } from 'cloudflare:test'`，beforeEach 显式 resetTables，不断言绝对自增 id）。

---

## File Structure

```
workers/src/lib/legacy-format.ts        # 新增：Zod schemas + decodeEntities + 常量
workers/src/handlers/migrate.ts         # 新增：exportJsonHandler + importJsonHandler
workers/src/router.ts                   # 修改：+2 路由（import 用 JSON body）
workers/tests/handlers/migrate.test.ts  # 新增：导出/导入全链路测试
workers/tests/router.test.ts            # 修改：+2 集成测试
workers/web/src/api/client.ts           # 修改：+postJson + exportJson/importJson
workers/web/src/routes/Admin/ImportExport.tsx  # 新增：导入导出页
workers/web/src/routes/Admin/Layout.tsx # 修改：侧边栏 +1 项
workers/web/src/App.tsx                 # 修改：+1 路由
```

---

## Task 1: lib/legacy-format.ts —— 格式定义与解码（TDD）

**Files:**
- Create: `workers/src/lib/legacy-format.ts`
- Create: `workers/tests/lib/legacy-format.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `workers/tests/lib/legacy-format.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { decodeEntities, onenavImportSchema, DEFAULT_CATEGORY_NAME } from '../../src/lib/legacy-format';

describe('decodeEntities（html_entity_decode ENT_QUOTES 等价，PHP 导出对称）', () => {
  it('五实体解码', () => {
    expect(decodeEntities('&lt;b&gt;A&amp;B&lt;/b&gt;')).toBe('<b>A&B</b>');
    expect(decodeEntities('&quot;x&quot;')).toBe('"x"');
    expect(decodeEntities('&#039;y&#039;')).toBe("'y'");
    expect(decodeEntities('&#39;z&#39;')).toBe("'z'");
  });
  it('&amp; 最后解码，避免二次解码（&amp;lt; → &lt; 字面量）', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
  });
  it('无实体原样返回', () => {
    expect(decodeEntities('普通中文 normal')).toBe('普通中文 normal');
  });
});

describe('onenavImportSchema', () => {
  const link = { title: 'A', url: 'https://a.com', description: '', backup_url: '', sort_order: 0 };
  const l2 = { name: '二级', description: '', links: [link] };
  const payload = {
    type: 'onenav.bookmarks',
    version: 1,
    categories: [{ name: '一级', description: '', links: [], children: [l2] }],
  };

  it('合法 payload 通过并补全默认值', () => {
    const parsed = onenavImportSchema.parse(payload);
    expect(parsed.type).toBe('onenav.bookmarks');
    expect(parsed.categories[0].children[0].links[0].url).toBe('https://a.com');
  });

  it('缺省字段补默认（description/backup_url/sort_order/children/links）', () => {
    const parsed = onenavImportSchema.parse({
      type: 'onenav.bookmarks',
      categories: [{ name: '一级', links: [{ title: 'A', url: 'u' }] }],
    });
    const cat = parsed.categories[0];
    expect(cat.description).toBe('');
    expect(cat.children).toEqual([]);
    expect(cat.links[0].backup_url).toBe('');
    expect(cat.links[0].sort_order).toBe(0);
  });

  it('type 不符拒绝', () => {
    expect(() => onenavImportSchema.parse({ ...payload, type: 'other' })).toThrow();
  });

  it('空 categories 拒绝（无意义导入）', () => {
    expect(() => onenavImportSchema.parse({ ...payload, categories: [] })).toThrow();
  });

  it('url 不限协议（旧书签可能有非 http scheme，与 DB 无格式约束一致）', () => {
    const parsed = onenavImportSchema.parse({
      type: 'onenav.bookmarks',
      categories: [{ name: 'x', links: [{ title: 'A', url: 'javascript:void(0)' }] }],
    });
    expect(parsed.categories[0].links[0].url).toBe('javascript:void(0)');
  });

  it('DEFAULT_CATEGORY_NAME 与 PHP 一致', () => {
    expect(DEFAULT_CATEGORY_NAME).toBe('默认分类');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/taowen/project/navbook/workers && pnpm exec vitest run tests/lib/legacy-format.test.ts 2>&1 | tail -3
```

Expected: FAIL（module not found）。

- [ ] **Step 3: 实现**

创建 `workers/src/lib/legacy-format.ts`：

```ts
import { z } from 'zod';

/** PHP export_json 的孤儿分类容器名（Api.php:858 '默认分类'） */
export const DEFAULT_CATEGORY_NAME = '默认分类';

/**
 * html_entity_decode($s, ENT_QUOTES, 'UTF-8') 的等价实现（覆盖 htmlspecialchars 产生的五种实体）。
 * &amp; 必须最后解码，否则 "&amp;lt;" 会被二次解码成 "<"。
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}

// ---- onenav.bookmarks 导入格式（与 PHP export_json / ZMark 互通）----

export const onenavLinkSchema = z.object({
  title: z.string().min(1).max(64),
  // 旧书签可能有任意 scheme，与 DB（无格式约束）一致，不校验 URL 形状
  url: z.string().min(1).max(256),
  description: z.string().max(256).optional().default(''),
  backup_url: z.string().max(256).optional().default(''),
  sort_order: z.coerce.number().int().min(0).optional().default(0),
});

export const onenavL2CategorySchema = z.object({
  name: z.string().min(1).max(32),
  description: z.string().max(128).optional().default(''),
  links: z.array(onenavLinkSchema).optional().default([]),
});

export const onenavL1CategorySchema = onenavL2CategorySchema.extend({
  children: z.array(onenavL2CategorySchema).optional().default([]),
});

export const onenavImportSchema = z.object({
  type: z.literal('onenav.bookmarks'),
  version: z.coerce.number().int().optional().default(1),
  categories: z.array(onenavL1CategorySchema).min(1),
});

export type OnenavLink = z.infer<typeof onenavLinkSchema>;
export type OnenavL2Category = z.infer<typeof onenavL2CategorySchema>;
export type OnenavL1Category = z.infer<typeof onenavL1CategorySchema>;
export type OnenavImportPayload = z.infer<typeof onenavImportSchema>;

/** 导出 payload 的形状（type/version/categories 嵌套树） */
export interface OnenavExportPayload {
  type: 'onenav.bookmarks';
  version: 1;
  categories: Array<{
    name: string;
    description: string;
    links: Array<{ title: string; url: string; description: string; backup_url: string; sort_order: number }>;
    children: Array<{
      name: string;
      description: string;
      links: Array<{ title: string; url: string; description: string; backup_url: string; sort_order: number }>;
    }>;
  }>;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/taowen/project/navbook/workers && pnpm test 2>&1 | tail -3
```

Expected: 既有 76 + 新增 8 = 84 全绿。

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/src/lib/legacy-format.ts workers/tests/lib/legacy-format.test.ts
git commit -m "feat(migrate): onenav.bookmarks format schemas + decodeEntities (TDD)"
```

（提交信息末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`，下同。）

---

## Task 2: exportJsonHandler（TDD）

**Files:**
- Create: `workers/src/handlers/migrate.ts`
- Create: `workers/tests/handlers/migrate.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `workers/tests/handlers/migrate.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { exportJsonHandler, importJsonHandler } from '../../src/handlers/migrate';
import { addCategoryHandler } from '../../src/handlers/category';
import { addLinkHandler } from '../../src/handlers/link';
import { resetTables } from '../helpers';

beforeEach(async () => {
  await resetTables();
});

const db = () => getDb(env.DB);

const catInput = (name: string, fid = 0, property = 0) =>
  ({ name, property, weight: 0, description: '', font_icon: '', fid });
const linkInput = (fid: number, title: string, url: string) =>
  ({ fid, title, url, description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });

describe('export_json', () => {
  it('空库返回空 categories + 固定 type/version', async () => {
    const res = await exportJsonHandler(db());
    expect(res.code).toBe(0);
    expect(res.data.type).toBe('onenav.bookmarks');
    expect(res.data.version).toBe(1);
    expect(res.data.categories).toEqual([]);
  });

  it('两级树结构 + 字段映射（backup_url/sort_order）+ 实体解码', async () => {
    const top = await addCategoryHandler(db(), catInput('一级'));
    const sub = await addCategoryHandler(db(), catInput('二级', top.id));
    await addLinkHandler(db(), { ...linkInput(top.id, 'A&B <tag>', 'https://a.com'), url_standby: 'https://bak.com', weight: 3 });
    await addLinkHandler(db(), linkInput(sub.id, 'Sub', 'https://s.com'));

    const res = await exportJsonHandler(db());
    const cats = res.data.categories;
    expect(cats.length).toBe(1);
    expect(cats[0].name).toBe('一级');
    expect(cats[0].links.length).toBe(1);
    // 实体解码：入库是 &amp;B &lt;tag&gt;，导出还原明文
    expect(cats[0].links[0].title).toBe('A&B <tag>');
    expect(cats[0].links[0].backup_url).toBe('https://bak.com');
    expect(cats[0].links[0].sort_order).toBe(3);
    expect(cats[0].children.length).toBe(1);
    expect(cats[0].children[0].links[0].url).toBe('https://s.com');
  });

  it('私有分类不出现在导出（导出面向导入/互通，不泄露私有）', async () => {
    await addCategoryHandler(db(), catInput('公开'));
    await addCategoryHandler(db(), catInput('私有', 0, 1));
    const res = await exportJsonHandler(db());
    expect(res.data.categories.map(c => c.name)).toEqual(['公开']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/taowen/project/navbook/workers && pnpm exec vitest run tests/handlers/migrate.test.ts 2>&1 | tail -3
```

Expected: FAIL（handlers/migrate 不存在）。

- [ ] **Step 3: 实现 exportJsonHandler**

创建 `workers/src/handlers/migrate.ts`：

```ts
import { eq, desc, and, inArray } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { decodeEntities, DEFAULT_CATEGORY_NAME, onenavImportSchema } from '../lib/legacy-format';
import type { OnenavExportPayload, OnenavImportPayload } from '../lib/legacy-format';
import { escapeHtml } from '../lib/escape';

type ExportLink = OnenavExportPayload['categories'][number]['links'][number];

/**
 * 导出为 PHP export_json 兼容格式（onenav.bookmarks）。
 * 仅导出公开数据（property=0）——导入/互通场景，私有不外流。
 */
export async function exportJsonHandler(
  db: DB,
): Promise<{ code: 0; data: OnenavExportPayload }> {
  const cats = await db.select({
    id: schema.categorys.id, name: schema.categorys.name,
    fid: schema.categorys.fid, weight: schema.categorys.weight,
    description: schema.categorys.description,
  }).from(schema.categorys)
    .where(eq(schema.categorys.property, 0))
    .orderBy(desc(schema.categorys.weight), desc(schema.categorys.id))
    .all();

  const catIds = cats.map(c => c.id);
  const links = catIds.length
    ? await db.select({
        fid: schema.links.fid, title: schema.links.title, url: schema.links.url,
        description: schema.links.description, urlStandby: schema.links.urlStandby,
        weight: schema.links.weight,
      }).from(schema.links)
        .where(and(eq(schema.links.property, 0), inArray(schema.links.fid, catIds)))
        .orderBy(desc(schema.links.weight), desc(schema.links.id))
        .all()
    : [];

  const toExportLink = (l: typeof links[number]): ExportLink => ({
    title: decodeEntities(l.title),
    url: l.url,
    description: decodeEntities(l.description ?? ''),
    backup_url: l.urlStandby ?? '',
    sort_order: l.weight,
  });

  // 组装两级树（PHP export_json:883-899 同构）：孤儿并入「默认分类」
  interface Node {
    id: number; name: string; description: string; weight: number;
    links: ExportLink[]; children: Node[];
  }
  const byId = new Map<number, Node>();
  for (const c of cats) {
    byId.set(c.id, {
      id: c.id, name: decodeEntities(c.name), description: decodeEntities(c.description ?? ''),
      weight: c.weight, links: [], children: [],
    });
  }
  const tops: Node[] = [];
  let orphan = false;
  for (const c of cats) {
    const node = byId.get(c.id)!;
    if (c.fid === 0) tops.push(node);
    else if (byId.has(c.fid)) byId.get(c.fid)!.children.push(node);
    else orphan = true; // 父分类（可能私有）不在导出集 → 归默认分类
  }
  for (const l of links) {
    byId.get(l.fid)?.links.push(toExportLink(l));
  }

  const payload: OnenavExportPayload = { type: 'onenav.bookmarks', version: 1, categories: [] };
  const stripL2 = (n: Node) => ({ name: n.name, description: n.description, links: n.links });
  for (const t of tops) {
    payload.categories.push({ name: t.name, description: t.description, links: t.links, children: t.children.map(stripL2) });
  }
  if (orphan) {
    // 孤儿二级分类（父为私有）→ 挂「默认分类」；其 links 已带在各自节点上
    const orphans: Node[] = [];
    for (const c of cats) {
      if (c.fid !== 0 && !byId.has(c.fid)) orphans.push(byId.get(c.id)!);
    }
    payload.categories.push({
      name: DEFAULT_CATEGORY_NAME,
      description: '',
      links: [],
      children: orphans.map(stripL2),
    });
  }

  return { code: 0, data: payload };
}
```

（importJsonHandler 在 Task 3 实现——本步先不导出它；文件顶部 import 暂时只放 Task 2 用到的，Task 3 再补。若 typecheck 报 unused import，先删掉暂时未用的。）

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/taowen/project/navbook/workers && pnpm exec vitest run tests/handlers/migrate.test.ts 2>&1 | tail -3
```

Expected: 3 个 export 测试 PASS。

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/src/handlers/migrate.ts workers/tests/handlers/migrate.test.ts
git commit -m "feat(migrate): export_json handler (PHP-compatible tree, entity-decoded)"
```

---

## Task 3: importJsonHandler（TDD）

**Files:**
- Modify: `workers/src/handlers/migrate.ts`
- Modify: `workers/tests/handlers/migrate.test.ts`

**导入算法（实现前明确）：**
1. Zod 校验（失败 throw → 路由 onError 转成 200 + code -2000，与既有链路一致）
2. 加载现有分类名→id（全表，分类量级小）、现有 URL 集（全表 `SELECT url`，个人书签量级可接受）
3. 逐分类「按名复用」：`ensureCategory(name, description, fid)` —— 名已存在则复用其 id（fid 不动，尊重现状）；不存在则插入（name/description 经 escapeHtml）后回查 id
4. 链接收集：L1 自身 links + 每个 children 的 links（fid 分别挂）；按 URL 去重（库内已有 或 文件内已见 均跳过）
5. `db.batch` 分块插入（每块 ≤50 条 insert 语句；每条语句绑定参数 ≤10，远低于 D1 100 参数/语句上限）
6. 返回统计；不抛错除非格式非法

**边界：**「默认分类」同名复用同样适用；全空/无新数据时统计为 0 也是成功。

- [ ] **Step 1: 写失败的测试**

`workers/tests/handlers/migrate.test.ts` 追加：

```ts
describe('import_json', () => {
  const payload = (categories: unknown[]) => ({ type: 'onenav.bookmarks', version: 1, categories });

  it('空库导入：建分类（两级）+ 插链接 + 统计', async () => {
    const res = await importJsonHandler(db(), payload([
      {
        name: '一级', description: 'd1',
        links: [{ title: 'A', url: 'https://a.com', description: 'x', backup_url: '', sort_order: 5 }],
        children: [{ name: '二级', description: '', links: [{ title: 'B', url: 'https://b.com' }] }],
      },
    ]));
    expect(res.code).toBe(0);
    expect(res.data.categories_created).toBe(2);
    expect(res.data.categories_reused).toBe(0);
    expect(res.data.links_imported).toBe(2);
    expect(res.data.links_skipped).toBe(0);

    // 数据真实落地且层级正确
    const { publicNavHandler } = await import('../../src/handlers/public');
    const nav = await publicNavHandler(db());
    expect(nav.data.categories[0].name).toBe('一级');
    expect(nav.data.categories[0].children[0].name).toBe('二级');
    expect(nav.data.categories[0].links[0].title).toBe('A');
  });

  it('重复导入幂等：分类复用 + URL 去重跳过', async () => {
    const p = payload([{ name: '一级', links: [{ title: 'A', url: 'https://a.com' }], children: [] }]);
    await importJsonHandler(db(), p);
    const again = await importJsonHandler(db(), p);
    expect(again.data.categories_created).toBe(0);
    expect(again.data.categories_reused).toBe(1);
    expect(again.data.links_imported).toBe(0);
    expect(again.data.links_skipped).toBe(1);
  });

  it('合并到已有数据：同名分类复用，新链接插入', async () => {
    const top = await addCategoryHandler(db(), catInput('一级'));
    await addLinkHandler(db(), linkInput(top.id, 'Old', 'https://old.com'));
    const res = await importJsonHandler(db(), payload([
      {
        name: '一级', links: [{ title: 'New', url: 'https://new.com' }],
        children: [{ name: '新二级', links: [] }],
      },
    ]));
    expect(res.data.categories_created).toBe(1);      // 只有"新二级"
    expect(res.data.categories_reused).toBe(1);       // "一级"复用
    expect(res.data.links_imported).toBe(1);
    expect(res.data.links_skipped).toBe(0);
    // 新链接挂到了已有"一级"下
    const { linkListHandler } = await import('../../src/handlers/link');
    const list = await linkListHandler(db(), 1, 100, true);
    expect(list.data.some((l: any) => l.title === 'New')).toBe(true);
  });

  it('文件内重复 URL 只导入一次', async () => {
    const res = await importJsonHandler(db(), payload([
      { name: 'x', links: [
        { title: 'A', url: 'https://dup.com' },
        { title: 'B', url: 'https://dup.com' },
      ], children: [] },
    ]));
    expect(res.data.links_imported).toBe(1);
    expect(res.data.links_skipped).toBe(1);
  });

  it('入库前 HTML 转义（与手建路径一致）', async () => {
    await importJsonHandler(db(), payload([
      { name: '<i>名</i>', links: [{ title: '<b>T</b>', url: 'https://a.com' }], children: [] },
    ]));
    const row = await env.DB.prepare("SELECT name FROM on_categorys WHERE id = (SELECT MIN(id) FROM on_categorys)").first<{ name: string }>();
    expect(row!.name).toBe('&lt;i&gt;名&lt;/i&gt;');
  });

  it('非法 type 拒绝', async () => {
    await expect(importJsonHandler(db(), { type: 'wrong', categories: [] })).rejects.toThrow();
  });

  it('空 title 链接被 schema 拒绝', async () => {
    await expect(importJsonHandler(db(), payload([
      { name: 'x', links: [{ title: '', url: 'https://a.com' }], children: [] },
    ]))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/taowen/project/navbook/workers && pnpm exec vitest run tests/handlers/migrate.test.ts 2>&1 | tail -3
```

Expected: FAIL（importJsonHandler 不存在）。

- [ ] **Step 3: 实现 importJsonHandler**

`workers/src/handlers/migrate.ts` 追加：

```ts
export interface ImportStats {
  categories_created: number;
  categories_reused: number;
  links_imported: number;
  links_skipped: number;
}

/**
 * 合并导入 onenav.bookmarks 格式：分类按名复用，链接按 URL 去重。
 * 个人书签量级（千级）下全表加载 name/url 集合可接受。
 */
export async function importJsonHandler(
  db: DB,
  payload: unknown,
): Promise<{ code: 0; data: ImportStats }> {
  const parsed: OnenavImportPayload = onenavImportSchema.parse(payload);

  const existingCats = await db.select({ id: schema.categorys.id, name: schema.categorys.name })
    .from(schema.categorys).all();
  const nameToId = new Map<string, number>(existingCats.map(c => [c.name, c.id]));
  const existingUrls = new Set(
    (await db.select({ url: schema.links.url }).from(schema.links).all()).map(l => l.url)
  );

  const stats: ImportStats = { categories_created: 0, categories_reused: 0, links_imported: 0, links_skipped: 0 };
  const now = Math.floor(Date.now() / 1000);

  async function ensureCategory(name: string, description: string, fid: number): Promise<number> {
    const hit = nameToId.get(name);
    if (hit !== undefined) {
      stats.categories_reused++;
      return hit;
    }
    await db.insert(schema.categorys).values({
      name: escapeHtml(name),
      addTime: now, weight: 0, property: 0,
      description: escapeHtml(description), fontIcon: null, fid,
    });
    const row = await db.select({ id: schema.categorys.id }).from(schema.categorys)
      .where(eq(schema.categorys.name, escapeHtml(name))).get();
    nameToId.set(name, row!.id);
    stats.categories_created++;
    return row!.id;
  }

  // 收集待插入链接（目标 fid 已解析）
  const pending: Array<{ fid: number; title: string; url: string; description: string; urlStandby: string; weight: number }> = [];
  const seen = new Set<string>(existingUrls);

  for (const l1 of parsed.categories) {
    const l1Id = await ensureCategory(l1.name, l1.description, 0);
    const targets: Array<[number, typeof l1.links[number][]>]> = [[l1Id, l1.links]];
    for (const child of l1.children) {
      targets.push([await ensureCategory(child.name, child.description, l1Id), child.links]);
    }
    for (const [fid, links] of targets) {
      for (const link of links) {
        if (seen.has(link.url)) {
          stats.links_skipped++;
          continue;
        }
        seen.add(link.url);
        pending.push({
          fid,
          title: escapeHtml(link.title),
          url: link.url,
          description: escapeHtml(link.description),
          urlStandby: link.backup_url || null,
          weight: link.sort_order,
        });
      }
    }
  }

  // 分块批量插入（D1 batch 每块原子；≤50 语句/块）
  for (let i = 0; i < pending.length; i += 50) {
    const chunk = pending.slice(i, i + 50);
    await db.batch(chunk.map(item =>
      db.insert(schema.links).values({
        ...item, addTime: now, property: 0, click: 0, topping: 0, fontIcon: null,
      }),
    ));
    stats.links_imported += chunk.length;
  }

  return { code: 0, data: stats };
}
```

（同时把文件顶部 import 补齐：`escapeHtml` 已在 Task 2 引入；确认 `onenavImportSchema`、`OnenavImportPayload` 已 import。）

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/taowen/project/navbook/workers && pnpm test 2>&1 | tail -3
```

Expected: 全绿（84 + 7 = 91 左右，以实际计数为准）。

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/src/handlers/migrate.ts workers/tests/handlers/migrate.test.ts
git commit -m "feat(migrate): import_json handler (name-reuse merge, URL dedup, chunked batch)"
```

---

## Task 4: 路由接线（import 走 JSON body）

**Files:**
- Modify: `workers/src/router.ts`
- Modify: `workers/tests/router.test.ts`

**注意：** import 端点收 **JSON body**（`c.req.json()`），不是既有 parseBody（FormData）——导入文件可达数百 KB，前端以 application/json 提交。

- [ ] **Step 1: router.test.ts 追加失败测试**

```ts
import { exportJsonHandler } from '../src/handlers/migrate';  // 文件顶部追加（若无）

// describe('router 集成') 内追加：
  it('export_json / import_json 需要鉴权', async () => {
    await seedUser();
    expect((await req('/api/export_json', form({}))).status).toBe(401);
    expect((await req('/api/import_json', { method: 'POST', body: '{}' })).status).toBe(401);
  });

  it('import_json（JSON body）导入后 export_json 往返一致', async () => {
    await seedUser();
    const payload = {
      type: 'onenav.bookmarks', version: 1,
      categories: [{
        name: '工具', description: '',
        links: [{ title: 'GitHub', url: 'https://github.com', description: '', backup_url: '', sort_order: 0 }],
        children: [],
      }],
    };
    const imp = await req('/api/import_json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      ...{} as RequestInit,
    });
    // req() 的第三参是 env；init 直接透传——若 req 包装不支持 headers+body 组合，参考既有 form() 用法调整
    const impJson = await imp.json() as any;
    expect(impJson.code).toBe(0);
    expect(impJson.data.links_imported).toBe(1);

    const exp = await req('/api/export_json', { ...form({}), headers: { 'X-Token': validToken() } });
    const expJson = await exp.json() as any;
    expect(expJson.data.categories[0].name).toBe('工具');
    expect(expJson.data.categories[0].links[0].url).toBe('https://github.com');
  });
```

（import 请求的鉴权用 X-Token header 写法：`{ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': validToken() }, body: JSON.stringify(payload) }`——上面片段里合并进 headers。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/taowen/project/navbook/workers && pnpm exec vitest run tests/router.test.ts 2>&1 | tail -3
```

Expected: FAIL（路由不存在，SPA fallback 拦截 /api/ 返回 404 或类型错）。

- [ ] **Step 3: 实现路由**

`workers/src/router.ts`：
- 顶部 import：`import { exportJsonHandler, importJsonHandler } from './handlers/migrate';`
- 写操作区（create_sk 旁）追加：

```ts
  app.post('/api/export_json', authMiddleware, async c => {
    return c.json(await exportJsonHandler(c.get('db')));
  });

  app.post('/api/import_json', authMiddleware, async c => {
    // 注意：本端点收 JSON body（非 FormData），与其它端点不同
    const payload = await c.req.json().catch(() => {
      throw new Error('请求体必须是 JSON');
    });
    return c.json(await importJsonHandler(c.get('db'), payload));
  });
```

- [ ] **Step 4: 跑全量测试确认通过**

```bash
cd /Users/taowen/project/navbook/workers && pnpm test 2>&1 | tail -3
```

Expected: 全绿（+2）。

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/src/router.ts workers/tests/router.test.ts
git commit -m "feat(migrate): wire /api/export_json + /api/import_json (JSON body)"
```

---

## Task 5: 前端「导入导出」页

**Files:**
- Modify: `workers/web/src/api/client.ts`
- Create: `workers/web/src/routes/Admin/ImportExport.tsx`
- Modify: `workers/web/src/routes/Admin/Layout.tsx`
- Modify: `workers/web/src/App.tsx`

- [ ] **Step 1: client.ts 追加**

在 `get` 函数后追加：

```ts
async function postJson<T = any>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return unwrap(res);
}
```

（`unwrap` 是既有私有函数——确认其签名后直接复用；若它定义在 post 内部则提升为模块级。）api 对象追加：

```ts
  exportJson: () => post('export_json'),
  importJson: (payload: unknown) => postJson('/api/import_json', payload),
```

- [ ] **Step 2: 创建 ImportExport.tsx**

```tsx
import { useRef, useState } from 'react';

interface ImportStats {
  categories_created: number;
  categories_reused: number;
  links_imported: number;
  links_skipped: number;
}

export function AdminImportExport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [pendingFile, setPendingFile] = useState<{ name: string; data: unknown } | null>(null);

  async function doExport() {
    setError('');
    setStats(null);
    try {
      const { api } = await import('@/api/client');
      const res = await api.exportJson();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `onenav-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError('');
    setStats(null);
    setPendingFile(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // 客户端预检：给出文件统计供确认
      const cats = Array.isArray((data as any)?.categories) ? (data as any).categories : [];
      const linkCount = cats.reduce(
        (n: number, c: any) => n + (c.links?.length ?? 0) + (c.children ?? []).reduce(
          (m: number, s: any) => m + (s.links?.length ?? 0), 0), 0);
      if (!cats.length) throw new Error('文件中没有分类数据（type 应为 onenav.bookmarks）');
      const ok = confirm(
        `文件「${file.name}」：${cats.length} 个分类 / ${linkCount} 条链接。\n` +
        '同名分类将合并，重复 URL 将跳过。确认导入？'
      );
      if (!ok) { if (fileRef.current) fileRef.current.value = ''; return; }
      setPendingFile({ name: file.name, data });
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取文件失败');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function doImport() {
    if (!pendingFile) return;
    setBusy(true);
    setError('');
    try {
      const { api } = await import('@/api/client');
      const res = await api.importJson(pendingFile.data);
      setStats(res.data);
      setPendingFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-bold mb-6" style={{ color: 'var(--color-text)' }}>导入 / 导出</h2>

      <section className="mb-8 p-4 border rounded" style={{ borderColor: 'var(--color-border)' }}>
        <h3 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>导出备份</h3>
        <p className="text-sm mb-3" style={{ color: 'var(--color-text-subtle)' }}>
          导出全部公开分类与链接（PHP OneNav / ZMark 兼容格式）。
        </p>
        <button
          type="button"
          onClick={doExport}
          className="px-4 py-2 rounded text-sm text-white"
          style={{ background: 'var(--color-primary)' }}
        >
          下载 JSON
        </button>
      </section>

      <section className="p-4 border rounded" style={{ borderColor: 'var(--color-border)' }}>
        <h3 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>导入书签</h3>
        <p className="text-sm mb-3" style={{ color: 'var(--color-text-subtle)' }}>
          支持从 PHP 版 OneNav 后台导出的 JSON（type: onenav.bookmarks）。同名分类合并，重复 URL 自动跳过。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          onChange={onFile}
          className="block w-full text-sm mb-3"
        />
        {pendingFile && (
          <button
            type="button"
            disabled={busy}
            onClick={doImport}
            className="px-4 py-2 rounded text-sm text-white disabled:opacity-50"
            style={{ background: 'var(--color-primary)' }}
          >
            {busy ? '导入中...' : `确认导入 ${pendingFile.name}`}
          </button>
        )}
        {stats && (
          <div className="mt-4 p-3 rounded text-sm" style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text)' }}>
            导入完成：新建分类 {stats.categories_created}、复用分类 {stats.categories_reused}、
            导入链接 {stats.links_imported}、跳过 {stats.links_skipped}。
          </div>
        )}
      </section>

      {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: 接线**

`Admin/Layout.tsx` 侧边栏「Token 管理」后追加（模式与既有一致）：

```tsx
          <br />
          <NavLink
            to="/admin/import-export"
            className={({ isActive }) => (isActive ? 'font-bold' : '')}
            style={{ color: 'var(--color-text)' }}
          >
            导入导出
          </NavLink>
```

`App.tsx` 嵌套路由追加（+ import）：

```tsx
<Route path="import-export" element={<AdminImportExport />} />
```

- [ ] **Step 4: 构建验证**

```bash
cd /Users/taowen/project/navbook/workers/web && pnpm build
```

Expected: 零错误。

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/navbook
git add workers/web/src
git commit -m "feat(web): import/export admin page with file preview + stats"
```

---

## Task 6: 端到端验证 + 部署

- [ ] **Step 1: 本地 E2E（模拟真实迁移）**

```bash
cd /Users/taowen/project/navbook/workers
rm -rf .wrangler/state/v3/d1 && pnpm db:migrate:local
(pnpm dev > /tmp/onenav-api.log 2>&1 &)
sleep 8

# init + 登录
curl -s -X POST http://localhost:8787/api/init -d "username=admin&password=test123" > /tmp/e2e-init.json
SK=$(python3 -c "import json;print(json.load(open('/tmp/e2e-init.json'))['data']['secret_key'])")
TOKEN=$(python3 -c "import hashlib;print(hashlib.md5(('admin'+'$SK').encode()).hexdigest())")

# 模拟 PHP 版导出的文件（含中文/实体/两级/重复 URL）
cat > /tmp/php-export.json <<'EOF'
{
  "type": "onenav.bookmarks",
  "version": 1,
  "categories": [
    {
      "name": "常用工具",
      "description": "日常",
      "links": [
        {"title": "GitHub", "url": "https://github.com", "description": "代码", "backup_url": "", "sort_order": 3},
        {"title": "重复链接", "url": "https://github.com", "description": "", "backup_url": "", "sort_order": 0}
      ],
      "children": [
        {"name": "开发", "description": "", "links": [
          {"title": "Cloudflare", "url": "https://cloudflare.com", "description": "", "backup_url": "https://www.cloudflare.com", "sort_order": 1}
        ]}
      ]
    }
  ]
}
EOF

# 导入
curl -s -X POST http://localhost:8787/api/import_json \
  -H "Content-Type: application/json" -H "X-Token: $TOKEN" \
  -d @/tmp/php-export.json && echo
# 期望 {code:0, data:{categories_created:2, categories_reused:0, links_imported:2, links_skipped:1}}

# 再导一次（幂等）
curl -s -X POST http://localhost:8787/api/import_json \
  -H "Content-Type: application/json" -H "X-Token: $TOKEN" \
  -d @/tmp/php-export.json && echo
# 期望 created 0 / reused 2 / imported 0 / skipped 1

# 导出往返
curl -s -X POST http://localhost:8787/api/export_json -H "X-Token: $TOKEN" | python3 -m json.tool | head -30
# 期望树结构与导入一致（常用工具 → 开发子分类，2 条链接）

# 首页数据
curl -s http://localhost:8787/api/public_nav | python3 -c "import json,sys;d=json.load(sys.stdin);print([c['name'] for c in d['data']['categories']])"
# 期望 ['常用工具']

pkill -f "wrangler" || true
```

- [ ] **Step 2: 浏览器走查（playwright 可用则做，不可用跳过）**

http://localhost:5173/admin/import-export：导出按钮下载文件；上传 /tmp/php-export.json 显示统计。清理：重置本地 D1。

- [ ] **Step 3: 部署 + 生产验证**

```bash
cd /Users/taowen/project/navbook/workers
pnpm run deploy
curl -s -o /dev/null -w "生产 export 未鉴权: %{http_code}\n" -X POST https://nav.wenonly.cn/api/export_json
# 期望 401
curl -s -o /dev/null -w "生产 import 未鉴权: %{http_code}\n" -X POST https://nav.wenonly.cn/api/import_json -H "Content-Type: application/json" -d '{}'
# 期望 401
```

（生产完整导入由用户在浏览器里自己操作。）

- [ ] **Step 4: 最终提交（如有零散调整）**

```bash
cd /Users/taowen/project/navbook && git status --short   # 期望干净
```

---

## Self-Review Checklist

**Spec §9 覆盖：**
- [x] 格式与 PHP export_json 完全兼容（Task 1 schemas + Task 2 导出，字段映射 backup_url/sort_order）
- [x] 导出实体解码 / 导入实体转义（对称）— Task 2/3
- [x] 孤儿分类并入默认分类 — Task 2（导出侧；导入侧天然无孤儿——children 直接挂 L1）
- [x] 分类按名复用合并 + URL 去重 + db.batch 分块 + 统计返回 — Task 3
- [x] 前端导入导出页（下载 / 文件预读确认 / 统计展示）— Task 5
- [x] 端到端（含幂等重导）+ 生产验证 — Task 6

**Placeholder scan:** 无 TBD/TODO/悬空引用。Task 4 测试片段中 req() 包装与 headers 组合标注了"以既有 form() 用法为准调整"，给了具体兜底写法。

**Type consistency:**
- `OnenavExportPayload`/`OnenavImportPayload`（Task 1 定义）在 Task 2/3 handler 签名一致
- `ImportStats` 四字段名在 Task 3 定义、Task 5 前端 `ImportStats` 接口逐字段一致
- `exportJsonHandler(db)` / `importJsonHandler(db, payload)` 在 Task 4 路由调用匹配
- `postJson`/`exportJson`/`importJson`（Task 5 client）与页面调用一致

**已知边界（有意决策，非缺陷）：**
- 导出仅含公开数据（property=1 不导出）——导入/互通场景防私有泄露
- 导入全表加载 name/url 集合——千级书签量级设计，10 万级需改游标
- 分块 batch 跨块非原子——URL 预去重后 UNIQUE 冲突概率极低，失败可整文件重导（幂等）
- property/font_icon 不随迁移（格式本身不含，PHP 行为一致）

