import { env } from 'cloudflare:test';

export async function resetTables() {
  await env.DB.exec(
    'DELETE FROM on_clicks; DELETE FROM on_shares; DELETE FROM on_links; ' +
    'DELETE FROM on_categorys; DELETE FROM on_options; DELETE FROM on_users;'
  );
}

/** 预置单用户 admin / 密码 test123（md5 存储）/ SecretKey=sk_test */
export async function seedUser() {
  const { md5 } = await import('../src/lib/md5');
  await env.DB.exec(
    `INSERT INTO on_users (username, password_hash, created_at) VALUES ('admin', '${md5('test123')}', 1710000000);`
  );
  await env.DB.exec(
    `INSERT INTO on_options (key, value) VALUES ('SecretKey', 'sk_test');`
  );
}

/** 合法插件 token = md5(username + SecretKey) */
export function validToken(md5fn: (s: string) => string) {
  return md5fn('admin' + 'sk_test');
}

/** 合法登录 cookie = md5(username + passwordHash + 'onenav' + ua) */
export function validCookie(md5fn: (s: string) => string, ua: string) {
  return md5fn('admin' + md5fn('test123') + 'onenav' + ua);
}
