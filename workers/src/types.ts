import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from './db/schema';

export type AppEnv = {
  // CloudflareBindings 由 wrangler cf-typegen 生成（wrangler.toml 的唯一事实源派生）
  // ASSETS 到 Task 19（assets binding）才会进生成类型，先用交叉类型补齐
  Bindings: CloudflareBindings & { ASSETS: Fetcher };
  Variables: {
    db: DrizzleD1Database<typeof schema>;
    isAuthed: boolean;
    username: string | null;
  };
};
