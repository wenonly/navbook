import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';

export const DEFAULT_THEME = 'compass';

export interface ThemeManifestEntry {
  id: string; name: string; version: string;
  author: string; description: string; minAppVersion: string;
}

/** s_themes.active：缺省 compass（代码常量，无需部署时写库） */
export async function getActiveTheme(db: DB): Promise<string> {
  const row = await db.select().from(schema.options).where(eq(schema.options.key, 's_themes')).get();
  if (!row?.value) return DEFAULT_THEME;
  try {
    const parsed = JSON.parse(row.value);
    return typeof parsed?.active === 'string' && parsed.active ? parsed.active : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export async function setActiveTheme(db: DB, theme: string): Promise<void> {
  const value = JSON.stringify({ active: theme });
  const existing = await db.select().from(schema.options).where(eq(schema.options.key, 's_themes')).get();
  if (existing) {
    await db.update(schema.options).set({ value }).where(eq(schema.options.key, 's_themes'));
  } else {
    await db.insert(schema.options).values({ key: 's_themes', value });
  }
}

/** manifest 合并：D1 覆盖段（未来 R2 上传）优先于 assets 段，按 id 去重 */
export function mergeManifest(d1: ThemeManifestEntry[], assets: ThemeManifestEntry[]): ThemeManifestEntry[] {
  const byId = new Map<string, ThemeManifestEntry>();
  for (const t of assets) byId.set(t.id, t);
  for (const t of d1) byId.set(t.id, t);   // D1 后写覆盖
  return [...byId.values()];
}
