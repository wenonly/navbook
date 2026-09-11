// handler 只返回纯对象（{ code, ... }），不返回 Response；Set-Cookie 副作用由 router 层处理（Task 12）。
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { authenticate } from '../middleware/auth';
import { md5 } from '../lib/md5';

/** check_login：复用 authenticate（单一鉴权路径，Task 8 要求，禁止 md5(username) 退化写法）。
 * 成功返回与 PHP check_login 的 return_json(200,"true","success") 逐字对齐——插件校验 code===200；
 * 失败带 err_msg（插件失败提示读该字段，对齐 PHP err_msg()）。 */
export async function checkLoginHandler(
  db: DB, token: string | undefined,
): Promise<{ code: number; data?: string; msg?: string; err_msg?: string }> {
  const name = await authenticate(db, '', token, undefined, '');
  if (!name) return { code: -1002, msg: 'Authorization failure!', err_msg: 'Authorization failure!' };
  return { code: 200, data: 'true', msg: 'success' };
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

/** app_info：SPA 启动元信息（版本/是否已初始化）。
 * code 200 + msg success 对齐 PHP return_json(200,...)——插件判 code==200 才读 onenav_version。
 * onenav_version 取 v1.x 形态：插件版本检查合法区间为 [0.9, 2)（parseFloat("0.9.32")=0.9，v>=2 触发"发生异常"分支被拒）。 */
export async function appInfoHandler(
  db: DB, clientVersion: string,
): Promise<{ code: 200; msg: 'success'; data: { version: string; onenav_version: string; client_version: string; has_user: boolean; username: string | null } }> {
  const user = await db.select().from(schema.users).limit(1).get();
  return {
    code: 200,
    msg: 'success',
    data: {
      version: '2.0.0',
      onenav_version: 'v1.2.4-navbook',
      client_version: clientVersion,
      has_user: !!user,
      username: user?.username ?? null,
    },
  };
}
