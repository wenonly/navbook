import { eq, desc, and, inArray } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { decodeEntities, DEFAULT_CATEGORY_NAME } from '../lib/legacy-format';
import type { OnenavExportPayload } from '../lib/legacy-format';
import { escapeHtml } from '../lib/escape';
import { onenavImportSchema } from '../lib/legacy-format';
import type { OnenavImportPayload, OnenavLink } from '../lib/legacy-format';

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

  // 组装两级树（PHP export_json:883-899 同构）：孤儿（父分类私有/缺失）并入「默认分类」
  interface Node {
    name: string; description: string;
    links: ExportLink[]; children: Node[];
  }
  const byId = new Map<number, Node & { fid: number }>();
  for (const c of cats) {
    byId.set(c.id, {
      fid: c.fid,
      name: decodeEntities(c.name), description: decodeEntities(c.description ?? ''),
      links: [], children: [],
    });
  }
  const tops: Array<Node> = [];
  let orphan = false;
  for (const c of cats) {
    const node = byId.get(c.id)!;
    if (c.fid === 0) tops.push(node);
    else if (byId.has(c.fid)) byId.get(c.fid)!.children.push(node);
    else orphan = true;
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

  const pending: Array<{ fid: number; title: string; url: string; description: string; urlStandby: string | null; weight: number }> = [];
  const seen = new Set<string>(existingUrls);

  for (const l1 of parsed.categories) {
    const l1Id = await ensureCategory(l1.name, l1.description, 0);
    const targets: Array<[number, OnenavLink[]]> = [[l1Id, l1.links]];
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
    const stmts = chunk.map(item =>
      db.insert(schema.links).values({
        ...item, addTime: now, property: 0, click: 0, topping: 0, fontIcon: null,
      }),
    );
    // batch 类型签名要求非空元组；i < pending.length 保证 chunk 至少 1 条
    await db.batch([stmts[0]!, ...stmts.slice(1)]);
    stats.links_imported += chunk.length;
  }

  return { code: 0, data: stats };
}
