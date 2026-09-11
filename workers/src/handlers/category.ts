// 错误文案与 PHP 原版逐字对齐（含中英混杂与拼写错误，如 'Categorie already exist!'），勿"修正"
import { eq, sql, desc } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { escapeHtml, decodeEntities } from '../lib/escape';
import { isUniqueViolation } from '../lib/d1-errors';

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
    const row = await db.insert(schema.categorys).values({
      name: escapeHtml(input.name),
      addTime: Math.floor(Date.now() / 1000),
      weight: input.weight,
      property: input.property,
      description: escapeHtml(input.description),
      // font_icon 刻意不转义（PHP 原版裸存，见 Api.php:56，前台直接拼 class）
      fontIcon: input.font_icon || null,
      fid: input.fid,
    }).returning({ id: schema.categorys.id }).get();
    return { code: 0, id: row.id };
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error('Categorie already exist!');
    throw e;
  }
}

export async function editCategoryHandler(db: DB, id: number, input: CategoryInput): Promise<{ code: 0; msg: string }> {
  if (!input.name.trim()) throw new Error('The category name cannot be empty!');

  if (input.fid !== 0) {
    if (input.fid === id) throw new Error('父分类不能是自己！');
    const parent = await db.select().from(schema.categorys).where(eq(schema.categorys.id, input.fid)).get();
    if (!parent) throw new Error('父级ID不存在！');
    if (parent.fid !== 0) throw new Error('父分类不能是二级分类!');
  }

  const childCount = await db.select({ c: sql<number>`count(*)` }).from(schema.categorys)
    .where(eq(schema.categorys.fid, id)).get();
  if ((childCount?.c ?? 0) > 0 && input.fid !== 0) {
    throw new Error('修改失败，该分类下已存在子分类！');
  }

  try {
    await db.update(schema.categorys).set({
      name: escapeHtml(input.name),
      upTime: Math.floor(Date.now() / 1000),
      weight: input.weight,
      property: input.property,
      description: escapeHtml(input.description),
      fontIcon: input.font_icon || null,
      fid: input.fid,
    }).where(eq(schema.categorys.id, id));
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error('The category name already exists!');  // PHP -1005 原文
    throw e;
  }
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
  // DB 存转义，读输出统一解码为明文
  const data = rows.map(r => ({
    ...r,
    name: decodeEntities(r.name),
    description: decodeEntities(r.description ?? ''),
  })) as CategoryRow[];
  return { code: 0, msg: '', count: countRow?.c ?? 0, data };
}

export async function getACategoryHandler(
  db: DB, id: number, isAuthed: boolean,
): Promise<{ code: number; data: CategoryRow | null; msg?: string }> {
  const row = await db.select().from(schema.categorys).where(eq(schema.categorys.id, id)).get();
  if (!row) return { code: -2000, msg: 'The category does not exist!', data: null };
  if (row.property === 1 && !isAuthed) {
    return { code: -1002, msg: 'Authorization failure!', data: null };
  }
  return {
    code: 0,
    data: {
      ...row,
      name: decodeEntities(row.name),
      description: decodeEntities(row.description ?? ''),
    } as CategoryRow,
  };
}
