// 约定：每个测试文件须在 beforeEach 里显式 resetTables()（vitest 4 + 本包无文件内逐测试回滚）；
// 测试不得断言绝对自增 id（sqlite_sequence 跨 DELETE 存活）。
import { env } from 'cloudflare:test';
import { isTable, getTableName } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import { md5 } from '../src/lib/md5';

// 表清单从 schema.ts 推导，避免与 schema/SQL 形成第三处硬编码。
const DELETE_ALL = Object.values(schema)
  .filter(isTable)
  .map(getTableName)
  .map((t) => `DELETE FROM ${t};`)
  .join(' ');

export async function resetTables() {
  await env.DB.exec(DELETE_ALL);
}

/** 预置单用户 admin / 密码 test123（md5 存储）/ SecretKey=sk_test */
export async function seedUser() {
  await env.DB.prepare(
    'INSERT INTO on_users (username, password_hash, created_at) VALUES (?, ?, ?)'
  )
    .bind('admin', md5('test123'), 1710000000)
    .run();
  await env.DB.prepare(
    "INSERT INTO on_options (key, value) VALUES ('SecretKey', 'sk_test')"
  ).run();
}

/** 合法插件 token = md5(username + SecretKey) */
export function validToken() {
  return md5('admin' + 'sk_test');
}

/** 合法登录 cookie = md5(username + passwordHash + 'onenav' + ua) */
export function validCookie(ua: string) {
  return md5('admin' + md5('test123') + 'onenav' + ua);
}
