// AI 域 handler 层:纯函数惯例,流式胶水不在此文件(见 router.ts ai_chat)。
import {
  loadAiConfig, saveAiConfig, maskConfig, mergeMaskedKeys, AI_PRESETS,
} from '../ai/config';
import { listConversations, deleteConversation, listMessages } from '../ai/conversations';
import type { WorkerDB } from '../ai/types';

export async function getAiConfigHandler(db: WorkerDB) {
  const config = await loadAiConfig(db);
  return { code: 0, data: { config: maskConfig(config), presets: AI_PRESETS } };
}

/** incoming 已在 router 层经 aiConfigSchema.parse(Zod 校验后的可信输入) */
export async function saveAiConfigHandler(db: WorkerDB, incoming: unknown) {
  const existing = await loadAiConfig(db);
  const merged = mergeMaskedKeys(existing, incoming as never);
  await saveAiConfig(db, merged);
  return { code: 0, data: { config: maskConfig(merged) } };
}

export async function listAiConversationsHandler(db: WorkerDB) {
  const rows = await listConversations(db);
  return { code: 0, data: rows.map(r => ({ id: r.id, title: r.title, updated_at: r.updatedAt })) };
}

export async function deleteAiConversationHandler(db: WorkerDB, id: number) {
  await deleteConversation(db, id);
  return { code: 0, data: null };
}

export async function listAiMessagesHandler(db: WorkerDB, cid: number) {
  const msgs = await listMessages(db, cid);
  return { code: 0, data: msgs.map(m => ({ id: m.id, role: m.role, content: m.content, created_at: m.createdAt })) };
}
