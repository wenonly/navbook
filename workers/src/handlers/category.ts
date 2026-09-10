import { eq, sql, desc } from 'drizzle-orm';
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

/**
 * drizzle 0.45 把 D1 底层错误包成 DrizzleQueryError（message 只有 "Failed query: ..."），
 * 真实的 UNIQUE 约束信息在 cause 链上（实测：
 *   cause[0] "D1_ERROR: UNIQUE constraint failed: on_categorys.name: SQLITE_CONSTRAINT ..."
 *   cause[1] "UNIQUE constraint failed: on_categorys.name: SQLITE_CONSTRAINT ..."），
 * 故沿 cause 链匹配而非只看顶层 message。
 */
function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur instanceof Error; i++) {
    if (cur.message.includes('UNIQUE')) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
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
    if (isUniqueViolation(e)) {
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
