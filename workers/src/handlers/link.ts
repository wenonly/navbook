// 错误文案与 PHP 原版逐字对齐（含中英混杂），勿"修正"
import { eq, sql, desc, and, inArray, like, or } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { escapeHtml, decodeEntities } from '../lib/escape';
import { isUniqueViolation } from '../lib/d1-errors';

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
    const row = await db.insert(schema.links).values({
      fid: input.fid,
      title: escapeHtml(input.title),
      url: input.url,
      urlStandby: input.url_standby || null,
      description: escapeHtml(input.description),
      addTime: Math.floor(Date.now() / 1000),
      weight: input.weight,
      property: input.property,
      // font_icon 刻意不转义（PHP 原版裸存，前台直接拼 class）
      ...(input.font_icon ? { fontIcon: input.font_icon } : {}),
    }).returning({ id: schema.links.id }).get();
    return { code: 0, id: row.id };
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error('The URL already exists!');
    throw e;
  }
}

export async function editLinkHandler(db: DB, id: number, input: LinkInput): Promise<{ code: 0; msg: string }> {
  const cat = await db.select().from(schema.categorys).where(eq(schema.categorys.id, input.fid)).get();
  if (!cat) throw new Error('分类ID不存在！');
  try {
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
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error('The URL already exists!');
    throw e;
  }
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
    // 注意必须表限定 on_links.fid：drizzle 把 ${schema.links.fid} 渲染成裸列名 "fid"，
    // 子查询里会被解析为 on_categorys.fid（顶级分类恒 0），相关匹配全部落空 → categoryName 恒 null
    categoryName: sql<string>`(SELECT name FROM on_categorys WHERE id = on_links.fid)`,
  }).from(schema.links)
    .where(where)
    .orderBy(desc(schema.links.weight), desc(schema.links.id))
    .limit(limit).offset(offset).all();

  // DB 存转义，读输出统一解码为明文（categoryName 子查询取的分类名同为转义存储）
  const data = rows.map(r => ({
    ...r,
    title: decodeEntities(r.title),
    description: decodeEntities(r.description ?? ''),
    categoryName: decodeEntities(r.categoryName ?? ''),
  })) as LinkRow[];
  return { code: 0, msg: '', count: countRow?.c ?? 0, data };
}

export async function qCategoryLinkHandler(
  db: DB, fid: number, page: number, limit: number, isAuthed: boolean,
): Promise<{ code: number; msg: string; count: number; data: LinkRow[] }> {
  if (!fid) return { code: -2000, msg: '分类ID不能为空！', count: 0, data: [] };
  return linkListHandler(db, page, limit, isAuthed, fid);
}

/** 模糊搜索：标题/URL/备用链接/描述（PHP global_search 对齐，插件搜索框用）。
 * 返回形状 {code:0, msg:'', count, data} 对齐 PHP；每项带 category_name。
 * keyword 原样拼 LIKE（与 PHP 一致不转义：SQLite LIKE 的 \ 默认无转义义，用户搜 %/_ 场景罕见）。
 * 已鉴权端点（PHP 原版 auth 后搜索，含私有链接）。 */
export async function globalSearchHandler(
  db: DB, keyword: string,
): Promise<{ code: 0; msg: ''; count: number; data: Array<LinkRow & { category_name: string }> }> {
  const pattern = `%${keyword}%`;
  const rows = await db.select({
    id: schema.links.id, fid: schema.links.fid, title: schema.links.title,
    url: schema.links.url, description: schema.links.description,
    addTime: schema.links.addTime, upTime: schema.links.upTime,
    weight: schema.links.weight, property: schema.links.property,
    click: schema.links.click, topping: schema.links.topping,
    urlStandby: schema.links.urlStandby, fontIcon: schema.links.fontIcon,
    // 表限定 on_links.fid（同 linkListHandler：防子查询解析到 on_categorys.fid）
    categoryName: sql<string>`(SELECT name FROM on_categorys WHERE id = on_links.fid)`,
  }).from(schema.links)
    .where(or(
      like(schema.links.title, pattern),
      like(schema.links.url, pattern),
      like(schema.links.urlStandby, pattern),
      like(schema.links.description, pattern),
    ))
    .orderBy(desc(schema.links.weight))
    .limit(100).all();

  // DB 存转义，读输出统一解码为明文（categoryName 子查询取的分类名同为转义存储）；
  // 分类名输出 snake_case category_name（插件读该字段，对齐 PHP）
  return {
    code: 0,
    msg: '',
    count: rows.length,
    data: rows.map(({ categoryName, ...r }) => ({
      ...r,
      title: decodeEntities(r.title),
      description: decodeEntities(r.description ?? ''),
      category_name: decodeEntities(categoryName ?? ''),
    })) as Array<LinkRow & { category_name: string }>,
  };
}

// select 刻意排除 iconBlob（Buffer 会被 c.json 序列化成巨大对象——Phase 3 图标上传后必须保持排除）
export async function getALinkHandler(
  db: DB, id: number, isAuthed: boolean,
): Promise<{ code: number; data: LinkRow | null; msg?: string }> {
  const row = await db.select({
    id: schema.links.id, fid: schema.links.fid, title: schema.links.title,
    url: schema.links.url, description: schema.links.description,
    addTime: schema.links.addTime, upTime: schema.links.upTime,
    weight: schema.links.weight, property: schema.links.property,
    click: schema.links.click, topping: schema.links.topping,
    urlStandby: schema.links.urlStandby, fontIcon: schema.links.fontIcon,
  }).from(schema.links).where(eq(schema.links.id, id)).get();
  if (!row) return { code: -2000, msg: 'Link not found', data: null };
  if (!isAuthed) {
    if (row.property === 1) return { code: -1002, msg: 'Authorization failure!', data: null };
    const cat = await db.select().from(schema.categorys).where(eq(schema.categorys.id, row.fid)).get();
    if (cat?.property === 1) return { code: -1002, msg: 'Authorization failure!', data: null };
  }
  return {
    code: 0,
    data: {
      ...row,
      title: decodeEntities(row.title),
      description: decodeEntities(row.description ?? ''),
    } as LinkRow,
  };
}
