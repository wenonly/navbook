// 返回结构与 @navbook/shared 的 NavData 契约对齐（只加字段不删不改语义）
import { eq, desc, and, inArray } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { decodeEntities } from '../lib/escape';

export interface PublicNavLink {
  id: number; fid: number; title: string; url: string;
  description: string | null; font_icon: string | null; url_standby: string | null;
  private: boolean;
}
export interface PublicNavCategory {
  id: number; name: string; font_icon: string | null; description: string | null;
  private: boolean;
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
 * 导航数据（两级分类树 + 链接）：
 * - 游客（isAuthed=false）：只返回公开分类与其下的公开链接，无 private 字段差异；
 * - 管理员（isAuthed=true）：全量返回，分类与链接均带 private 标记供前端区分渲染。
 * 供 SPA 首页渲染，无需强制鉴权。
 */
export async function publicNavHandler(db: DB, isAuthed: boolean): Promise<PublicNavResult> {
  const cats = await db.select({
    id: schema.categorys.id, name: schema.categorys.name,
    fid: schema.categorys.fid, fontIcon: schema.categorys.fontIcon,
    description: schema.categorys.description, property: schema.categorys.property,
  }).from(schema.categorys)
    .where(isAuthed ? undefined : eq(schema.categorys.property, 0))
    .orderBy(desc(schema.categorys.weight), desc(schema.categorys.id))
    .all();

  const catIds = cats.map(c => c.id);
  const pubLinks = catIds.length
    ? await db.select({
        id: schema.links.id, fid: schema.links.fid, title: schema.links.title,
        url: schema.links.url, description: schema.links.description,
        fontIcon: schema.links.fontIcon, urlStandby: schema.links.urlStandby,
        property: schema.links.property,
      }).from(schema.links)
        .where(isAuthed
          ? inArray(schema.links.fid, catIds)
          : and(eq(schema.links.property, 0), inArray(schema.links.fid, catIds)))
        .orderBy(desc(schema.links.weight), desc(schema.links.id))
        .all()
    : [];

  // 组装两级树：顶级 → children（二级）→ 各自 links
  const byId = new Map<number, PublicNavCategory>();
  const tops: PublicNavCategory[] = [];
  for (const c of cats) {
    byId.set(c.id, {
      id: c.id, name: decodeEntities(c.name), font_icon: c.fontIcon,
      description: decodeEntities(c.description ?? ''), private: c.property === 1,
      children: [], links: [],
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
      private: l.property === 1,
    });
  }

  const titleRow = await db.select().from(schema.options)
    .where(eq(schema.options.key, 'site_title')).get();

  return {
    code: 0,
    data: {
      site_title: titleRow?.value || 'NavBook',
      site_subtitle: '',
      categories: tops,
    },
  };
}
