// AI 域 handler 层:纯函数惯例,流式胶水不在此文件(见 router.ts ai_chat)。
import {
  loadAiConfig, saveAiConfig, maskConfig, mergeMaskedKeys, AI_PRESETS,
} from '../ai/config';
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
