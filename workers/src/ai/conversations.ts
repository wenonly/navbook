// 会话/消息 CRUD。只依赖 db;不知道 agent/provider 的存在(单向依赖)。
import { eq, desc, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { ChatMsgContent, WorkerDB } from './types';

const now = () => Math.floor(Date.now() / 1000);

export interface ConversationRow {
  id: number; title: string; createdAt: number; updatedAt: number;
}
export interface ChatMessageDto {
  id: number; role: 'user' | 'assistant' | 'tool'; content: ChatMsgContent; createdAt: number;
}

export async function createConversation(db: WorkerDB, title: string): Promise<ConversationRow> {
  const t = now();
  const row = await db.insert(schema.aiConversations)
    .values({ title, createdAt: t, updatedAt: t })
    .returning().get();
  return row;
}

export async function listConversations(db: WorkerDB): Promise<ConversationRow[]> {
  return db.select().from(schema.aiConversations)
    .orderBy(desc(schema.aiConversations.updatedAt), desc(schema.aiConversations.id)).all();
}

export async function deleteConversation(db: WorkerDB, id: number): Promise<void> {
  await db.delete(schema.aiConversations).where(eq(schema.aiConversations.id, id));
  await db.delete(schema.aiMessages).where(eq(schema.aiMessages.conversationId, id));
}

/** 首条消息且标题为空时,自动以消息前 20 字作标题(spec:不额外调模型) */
async function maybeSetTitle(db: WorkerDB, conversationId: number, firstText: string) {
  const conv = await db.select().from(schema.aiConversations)
    .where(eq(schema.aiConversations.id, conversationId)).get();
  if (conv && !conv.title) {
    await db.update(schema.aiConversations)
      .set({ title: firstText.slice(0, 20) })
      .where(eq(schema.aiConversations.id, conversationId));
  }
}

export async function insertMessage(
  db: WorkerDB, conversationId: number,
  role: 'user' | 'assistant' | 'tool', content: ChatMsgContent,
): Promise<{ id: number }> {
  const row = await db.insert(schema.aiMessages)
    .values({ conversationId, role, content: JSON.stringify(content), createdAt: now() })
    .returning({ id: schema.aiMessages.id }).get();
  await db.update(schema.aiConversations)
    .set({ updatedAt: now() })
    .where(eq(schema.aiConversations.id, conversationId));
  if (role === 'user' && 'text' in content) await maybeSetTitle(db, conversationId, content.text);
  return row;
}

export async function updateMessageContent(db: WorkerDB, id: number, content: ChatMsgContent): Promise<void> {
  await db.update(schema.aiMessages)
    .set({ content: JSON.stringify(content) })
    .where(eq(schema.aiMessages.id, id));
}

export async function listMessages(db: WorkerDB, conversationId: number): Promise<ChatMessageDto[]> {
  const rows = await db.select().from(schema.aiMessages)
    .where(eq(schema.aiMessages.conversationId, conversationId))
    .orderBy(schema.aiMessages.id).all();
  return rows.map(r => ({
    id: r.id,
    role: r.role as ChatMessageDto['role'],
    content: JSON.parse(r.content) as ChatMsgContent,
    createdAt: r.createdAt,
  }));
}

export async function countMessages(db: WorkerDB, conversationId: number): Promise<number> {
  const row = await db.select({ c: sql<number>`count(*)` }).from(schema.aiMessages)
    .where(eq(schema.aiMessages.conversationId, conversationId)).get();
  return row?.c ?? 0;
}
