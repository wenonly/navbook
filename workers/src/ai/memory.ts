// 长期记忆:单文档形态(MEMORY.md 式),存 on_options key s_ai_memory。
// 纯文本、模型自维护(memory_write 整体替换)、全量注入 system prompt。
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { WorkerDB } from './types';
import { insertOpLog, type OpMeta } from '../handlers/oplog';

const KEY = 's_ai_memory';

export const MEMORY_MAX_CHARS = 4000;

export async function loadMemory(db: WorkerDB): Promise<string> {
  const row = await db.select().from(schema.options).where(eq(schema.options.key, KEY)).get();
  return typeof row?.value === 'string' ? row.value : '';
}

export async function saveMemory(db: WorkerDB, content: string, meta?: OpMeta): Promise<void> {
  const before = await loadMemory(db);
  await db.insert(schema.options).values({ key: KEY, value: content })
    .onConflictDoUpdate({ target: schema.options.key, set: { value: content } });
  if (before !== content) {
    await insertOpLog(db, {
      action: 'memory.update',
      summary: `更新长期记忆(${content.length} 字)`,
      before: { content: before }, after: { content },
    }, meta);
  }
}
