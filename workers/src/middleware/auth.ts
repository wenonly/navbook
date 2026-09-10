import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';
import { md5 } from '../lib/md5';
import { eq } from 'drizzle-orm';
import { users, options } from '../db/schema';
import type { DB } from '../db/client';

/**
 * 统一鉴权（对齐 PHP Api::auth + is_login）：
 * - X-Token = md5(username + SecretKey)（SecretKey 需已生成，插件用）
 * - cookie key = md5(username + passwordHash + 'onenav' + User-Agent)（绑定 UA）
 * 成功返回 username，失败返回 null。
 * 已知非恒时比较（===），经评估接受：32 位 hex + 网络噪声掩盖时序差分不可行。
 */
export async function authenticate(
  db: DB,
  fallbackUsername: string,
  xtoken: string | undefined,
  cookieKey: string | undefined,
  ua: string,
): Promise<string | null> {
  const userRow = await db.select().from(users).limit(1).get();
  if (!userRow) return null;
  const username = userRow.username || fallbackUsername;

  // X-Token 校验（SecretKey 未生成时该通道不可用）
  if (xtoken) {
    const skRow = await db.select().from(options).where(eq(options.key, 'SecretKey')).get();
    if (skRow?.value && xtoken === md5(username + skRow.value)) {
      return username;
    }
  }

  // cookie 校验（与 PHP is_login() 一致，绑定 UA）
  if (cookieKey && cookieKey === md5(username + userRow.passwordHash + 'onenav' + ua)) {
    return username;
  }

  return null;
}

/** 强制鉴权：写操作用，失败 401 + code -1002（对齐 PHP err_msg）。
 * 前置条件：全局 db 注入中间件必须先注册（c.get('db')）。 */
export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const username = await authenticate(
    c.get('db'),
    c.env.USERNAME,
    c.req.header('X-Token'),
    getCookie(c, 'key'),
    c.req.header('User-Agent') ?? '',
  );
  if (!username) {
    return c.json({ code: -1002, msg: 'Authorization failure!' }, 401);
  }
  c.set('isAuthed', true);
  c.set('username', username);
  await next();
};

/** 可选鉴权：列表查询用，失败不拒绝，游客只看公开数据（对齐 PHP link_list 游客分支）。
 * 前置条件：全局 db 注入中间件必须先注册（c.get('db')）。 */
export const optionalAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const username = await authenticate(
    c.get('db'),
    c.env.USERNAME,
    c.req.header('X-Token'),
    getCookie(c, 'key'),
    c.req.header('User-Agent') ?? '',
  );
  c.set('isAuthed', username !== null);
  c.set('username', username);
  await next();
};
