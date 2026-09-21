// 操作日志:全量留痕的记录侧(读取侧是 AI 工具 op_log_list)。
// 在写 handler 成功后调用 insertOpLog;快照存整行业务字段(排除 icon_blob——
// Buffer 体积大且现有工具不还原图标),AI 读快照即可组合现有工具自行还原。
import { eq, desc, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { DB } from '../db/client';

export interface OpMeta {
  source?: 'manual' | 'ai';
  conversationId?: number;
}

export interface OpLogEntry {
  id: number;
  action: string;
  source: string;
  conversationId: number | null;
  targetId: number | null;
  summary: string;
  before: unknown;
  after: unknown;
  createdAt: number;
}

export async function insertOpLog(
  db: DB,
  entry: { action: string; targetId?: number; summary: string; before?: unknown; after?: unknown },
  meta?: OpMeta,
): Promise<void> {
  await db.insert(schema.opLogs).values({
    action: entry.action,
    source: meta?.source ?? 'manual',
    conversationId: meta?.conversationId ?? null,
    targetId: entry.targetId ?? null,
    summary: entry.summary,
    beforeJson: entry.before === undefined ? null : JSON.stringify(entry.before),
    afterJson: entry.after === undefined ? null : JSON.stringify(entry.after),
    createdAt: Math.floor(Date.now() / 1000),
  });
}

/** 链接整行业务快照(排除 icon_blob/icon_source) */
export async function snapshotLink(db: DB, id: number): Promise<Record<string, unknown> | null> {
  const row = await db.select({
    id: schema.links.id, fid: schema.links.fid, title: schema.links.title,
    url: schema.links.url, description: schema.links.description,
    weight: schema.links.weight, property: schema.links.property,
    click: schema.links.click, topping: schema.links.topping,
    urlStandby: schema.links.urlStandby, fontIcon: schema.links.fontIcon,
  }).from(schema.links).where(eq(schema.links.id, id)).get();
  return row ?? null;
}

/** 分类整行快照 */
export async function snapshotCategory(db: DB, id: number): Promise<Record<string, unknown> | null> {
  const row = await db.select().from(schema.categorys).where(eq(schema.categorys.id, id)).get();
  return row ?? null;
}

/** 最近日志(读取侧,AI 工具用) */
export async function listOpLogs(db: DB, limit: number): Promise<OpLogEntry[]> {
  const rows = await db.select().from(schema.opLogs)
    .orderBy(desc(schema.opLogs.id))
    .limit(limit).all();
  return rows.map(r => ({
    id: r.id, action: r.action, source: r.source,
    conversationId: r.conversationId, targetId: r.targetId, summary: r.summary,
    before: r.beforeJson ? JSON.parse(r.beforeJson) : null,
    after: r.afterJson ? JSON.parse(r.afterJson) : null,
    createdAt: r.createdAt,
  }));
}

/** 分页列表(管理端页面用):倒序 + 总数 */
export async function pagedOpLogs(
  db: DB, page: number, limit: number,
): Promise<{ code: 0; count: number; data: OpLogEntry[] }> {
  const offset = (page - 1) * limit;
  const countRow = await db.select({ c: sql<number>`count(*)` }).from(schema.opLogs).get();
  const rows = await db.select().from(schema.opLogs)
    .orderBy(desc(schema.opLogs.id))
    .limit(limit).offset(offset).all();
  return {
    code: 0,
    count: countRow?.c ?? 0,
    data: rows.map(r => ({
      id: r.id, action: r.action, source: r.source,
      conversationId: r.conversationId, targetId: r.targetId, summary: r.summary,
      before: r.beforeJson ? JSON.parse(r.beforeJson) : null,
      after: r.afterJson ? JSON.parse(r.afterJson) : null,
      createdAt: r.createdAt,
    })),
  };
}
