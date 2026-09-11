import { eq, desc, and, inArray } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { decodeEntities } from '../lib/escape';

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

  // 组装两级树：顶级 → children（二级）→ 各自 links
  const byId = new Map<number, PublicNavCategory>();
  const tops: PublicNavCategory[] = [];
  for (const c of cats) {
    byId.set(c.id, {
      id: c.id, name: decodeEntities(c.name), font_icon: c.fontIcon,
      description: decodeEntities(c.description ?? ''), children: [], links: [],
    });
  }
  for (const c of cats) {
    const node = byId.get(c.id)!;
    if (c.fid === 0 || !byId.has(c.fid)) tops.push(node);
    else byId.get(c.fid)!.children.push(node);
  }
  for (const l of pubLinks) {
    byId.get(l.fid)?.links.push({
      id: l.id, fid: l.fid, title: decodeEntities(l.title), url: l.url,
      description: decodeEntities(l.description ?? ''), font_icon: l.fontIcon, url_standby: l.urlStandby,
    });
  }

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
