import { eq, desc, and, inArray } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { decodeEntities, DEFAULT_CATEGORY_NAME } from '../lib/legacy-format';
import type { OnenavExportPayload } from '../lib/legacy-format';

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
