import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';

export interface SiteConfig {
  sitePrivate: boolean;
  siteTitle: string;
  siteSubtitle: string;
}

export const DEFAULT_SITE_TITLE = 'NavBook';

/** on_options 三键：site_private（'1'=开）/ site_title / site_subtitle；缺省即公开 + 默认标题 */
export async function getSiteConfig(db: DB): Promise<SiteConfig> {
  const rows = await db.select().from(schema.options).all();
  const byKey = new Map(rows.map(r => [r.key, r.value]));
  return {
    sitePrivate: byKey.get('site_private') === '1',
    siteTitle: byKey.get('site_title') || DEFAULT_SITE_TITLE,
    siteSubtitle: byKey.get('site_subtitle') || '',
  };
}

/** API 输出契约（snake_case，对齐前端与其余端点风格） */
export function siteConfigData(s: SiteConfig) {
  return { site_private: s.sitePrivate, site_title: s.siteTitle, site_subtitle: s.siteSubtitle };
}

export async function setSiteConfig(
  db: DB,
  patch: { sitePrivate?: boolean; siteTitle?: string; siteSubtitle?: string },
): Promise<void> {
  const upserts: Array<[string, string]> = [];
  if (patch.sitePrivate !== undefined) upserts.push(['site_private', patch.sitePrivate ? '1' : '0']);
  if (patch.siteTitle !== undefined) upserts.push(['site_title', patch.siteTitle.slice(0, 64)]);
  if (patch.siteSubtitle !== undefined) upserts.push(['site_subtitle', patch.siteSubtitle.slice(0, 128)]);
  for (const [key, value] of upserts) {
    await db.insert(schema.options).values({ key, value })
      .onConflictDoUpdate({ target: schema.options.key, set: { value } });
  }
}

/** 隐私门禁共用：开启且未登录返回 true（调用方据此 302/401） */
export async function isPrivateAndGuest(db: DB, isAuthed: boolean): Promise<boolean> {
  if (isAuthed) return false;
  const row = await db.select().from(schema.options)
    .where(eq(schema.options.key, 'site_private')).get();
  return row?.value === '1';
}
