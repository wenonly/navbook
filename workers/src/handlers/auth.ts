// handler 只返回纯对象（{ code, ... }），不返回 Response；Set-Cookie 副作用由 router 层处理（Task 12）。
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { authenticate } from '../middleware/auth';
import { md5 } from '../lib/md5';

/** check_login：复用 authenticate（单一鉴权路径，Task 8 要求，禁止 md5(username) 退化写法） */
export async function checkLoginHandler(
  db: DB, token: string | undefined,
): Promise<{ code: number; data?: { username: string }; msg?: string }> {
  const name = await authenticate(db, '', token, undefined, '');
  if (!name) return { code: -1002, msg: 'Authorization failure!' };
  return { code: 0, data: { username: name } };
}

/** create_sk：生成/覆盖 SecretKey（对齐 PHP：存 on_options，插件 token 用） */
export async function createSkHandler(db: DB): Promise<{ code: 0; data: { secret_key: string } }> {
  const user = await db.select().from(schema.users).limit(1).get();
  if (!user) throw new Error('请先初始化用户！');
  const sk = crypto.randomUUID().replace(/-/g, '');
  await db.insert(schema.options).values({ key: 'SecretKey', value: sk })
    .onConflictDoUpdate({ target: schema.options.key, set: { value: sk } });
  return { code: 0, data: { secret_key: sk } };
}

/** token_info：展示当前用户的 SecretKey 与插件 X-Token（md5(username + sk)），供后台 Token 管理页用 */
export async function tokenInfoHandler(
  db: DB,
): Promise<{ code: number; data?: { username: string; secret_key: string | null; token: string | null }; msg?: string }> {
  const user = await db.select().from(schema.users).limit(1).get();
  if (!user) return { code: -2000, msg: '请先初始化用户！' };
  const skRow = await db.select().from(schema.options).where(eq(schema.options.key, 'SecretKey')).get();
  const sk = skRow?.value ?? null;
  return {
    code: 0,
    data: { username: user.username, secret_key: sk, token: sk ? md5(user.username + sk) : null },
  };
}

/** app_info：SPA 启动元信息（版本/是否已初始化） */
export async function appInfoHandler(
  db: DB, clientVersion: string,
): Promise<{ code: 0; data: { version: string; client_version: string; has_user: boolean; username: string | null } }> {
  const user = await db.select().from(schema.users).limit(1).get();
  return {
    code: 0,
    data: {
      version: '1.0.0',
      client_version: clientVersion,
      has_user: !!user,
      username: user?.username ?? null,
    },
  };
}
