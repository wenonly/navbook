// handler 只返回纯对象（{ code, ... }），不返回 Response；Set-Cookie 副作用由 router 层处理（Task 12）。
import type { DB } from '../db/client';
import * as schema from '../db/schema';
import { md5 } from '../lib/md5';

/** init：首个用户初始化 + 生成 SecretKey（SecretKey 存 on_options 对齐 PHP） */
export async function initHandler(
  db: DB, username: string, password: string,
): Promise<{ code: 0; data: { username: string; secret_key: string } }> {
  const existing = await db.select().from(schema.users).limit(1).get();
  if (existing) throw new Error('已经初始化过，如需重置请清空 on_users 表');

  await db.insert(schema.users).values({
    username,
    passwordHash: md5(password),
    secretKey: null,
    createdAt: Math.floor(Date.now() / 1000),
  });
  // 同时生成 SecretKey（插件 token 用，存 on_options 对齐 PHP）
  const sk = crypto.randomUUID().replace(/-/g, '');
  await db.insert(schema.options).values({ key: 'SecretKey', value: sk })
    .onConflictDoUpdate({ target: schema.options.key, set: { value: sk } });
  return { code: 0, data: { username, secret_key: sk } };
}

/** login：校验密码，返回登录 cookie（绑定 UA，与 authenticate cookie 通道一致，router 层写 Set-Cookie） */
export async function loginHandler(
  db: DB, password: string, ua: string,
): Promise<{ code: number; data?: { username: string; cookie: string }; msg?: string }> {
  const user = await db.select().from(schema.users).limit(1).get();
  if (!user) return { code: -2000, msg: '用户未初始化' };
  // 兼容明文（旧数据）与 md5 两种存储
  if (user.passwordHash !== md5(password) && user.passwordHash !== password) {
    return { code: -1002, msg: '密码错误' };
  }
  const cookie = md5(user.username + user.passwordHash + 'onenav' + ua);
  return { code: 0, data: { username: user.username, cookie } };
}
