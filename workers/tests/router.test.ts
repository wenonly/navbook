import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createApp } from '../src/router';
import { resetTables, seedUser, validToken } from './helpers';

beforeEach(async () => {
  await resetTables();
});

// workers-types 的 Response.json() 返回 Promise<unknown>，统一在此断言（与 auth.test.ts 一致）
async function json(res: Response): Promise<any> {
  return (await res.json()) as any;
}

// testEnv：与 auth.test.ts 相同的 cast 模式（类型上缺 Task 19 的 ASSETS，运行时齐全）
const testEnv = env as unknown as import('../src/types').AppEnv['Bindings'];

function req(path: string, init?: RequestInit) {
  return createApp().request(path, init, testEnv);
}

function form(body: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) fd.append(k, v);
  return { method: 'POST', body: fd } as RequestInit;
}

describe('router 集成', () => {
  it('GET /api/public_nav 空库 200', async () => {
    const res = await req('/api/public_nav');
    expect(res.status).toBe(200);
    expect((await json(res)).data.categories).toEqual([]);
  });

  it('POST /api/app_info 公开可访问', async () => {
    const res = await req('/api/app_info', form({}));
    expect((await json(res)).data.has_user).toBe(false);
  });

  it('未知 /api 方法返回 JSON 404', async () => {
    const res = await req('/api/no_such_method', form({}));
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe(-404);
  });

  it('CORS：OPTIONS 预检 204 + 五头', async () => {
    const res = await req('/api/public_nav', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Token');
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe('X-Token');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('CORS：普通响应带三头', async () => {
    const res = await req('/api/public_nav');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Token');
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe('X-Token');
  });

  it('写操作无凭据 401，带 X-Token 通过（插件链路）', async () => {
    await seedUser();
    const noAuth = await req('/api/add_category', form({ name: '工具' }));
    expect(noAuth.status).toBe(401);

    const ok = await req('/api/add_category', {
      ...form({ name: '工具' }),
      headers: { 'X-Token': validToken() },
    });
    const body = await json(ok);
    expect(body.code).toBe(0);
    expect(body.id).toBeGreaterThan(0);
  });

  it('category_list 游客 vs X-Token 可见性', async () => {
    await seedUser();
    await req('/api/add_category', { ...form({ name: '公开' }), headers: { 'X-Token': validToken() } });
    await req('/api/add_category', { ...form({ name: '私有', property: '1' }), headers: { 'X-Token': validToken() } });

    const guest = await json(await req('/api/category_list?page=1&limit=10', form({})));
    expect(guest.count).toBe(1);
    const admin = await json(await req('/api/category_list?page=1&limit=10', {
      ...form({}),
      headers: { 'X-Token': validToken() },
    }));
    expect(admin.count).toBe(2);
  });

  it('init → login → Set-Cookie 且响应体无 cookie 值 → cookie 调 session', async () => {
    const init = await req('/api/init', form({ username: 'admin', password: 'test123' }));
    expect((await json(init)).code).toBe(0);

    // login 的 UA 与后续 session 请求必须一致（cookie 公式绑定 UA）
    const ua = 'router-test';
    const login = await req('/api/login', { ...form({ password: 'test123' }), headers: { 'User-Agent': ua } });
    const loginJson = await json(login);
    expect(loginJson.code).toBe(0);
    expect(loginJson.data.cookie).toBeUndefined();          // cookie 不进 body
    const setCookie = login.headers.get('Set-Cookie');
    expect(setCookie).toContain('key=');
    expect(setCookie).toContain('HttpOnly');

    // 用 Set-Cookie 的值作为 cookie 调 session（提取 key=... 段）
    const cookieVal = setCookie!.match(/key=([^;]+)/)![1];
    const session = await req('/api/session', { headers: { Cookie: `key=${cookieVal}`, 'User-Agent': ua } });
    expect((await json(session)).data.username).toBe('admin');
  });

  it('login UA 不一致时 session 失效（cookie 绑定 UA）', async () => {
    await req('/api/init', form({ username: 'admin', password: 'test123' }));
    const login = await req('/api/login', { ...form({ password: 'test123' }), headers: { 'User-Agent': 'ua-a' } });
    const cookieVal = login.headers.get('Set-Cookie')!.match(/key=([^;]+)/)![1];
    const session = await req('/api/session', { headers: { Cookie: `key=${cookieVal}`, 'User-Agent': 'different-ua' } });
    expect((await json(session)).data.username).toBeNull();
  });

  it('token_info 需要鉴权，带 X-Token 返回 token', async () => {
    await seedUser();
    const noAuth = await req('/api/token_info');
    expect(noAuth.status).toBe(401);
    const ok = await req('/api/token_info', { headers: { 'X-Token': validToken() } });
    const json = await ok.json() as any;
    expect(json.code).toBe(0);
    expect(json.data.token).toBe(validToken());
    expect(json.data.secret_key).toBe('sk_test');
  });

  it('Zod 校验失败走 error 中间件 200 + code -2000', async () => {
    await seedUser();
    const res = await req('/api/add_link', {
      ...form({ fid: '1', title: 'x', url: 'not-a-url' }),
      headers: { 'X-Token': validToken() },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.code).toBe(-2000);
    expect(String(body.msg)).toContain('url');  // zod 错误信息提到 url 字段
  });

  it('export_json / import_json 需要鉴权', async () => {
    await seedUser();
    expect((await req('/api/export_json', form({}))).status).toBe(401);
    expect((await req('/api/import_json', { method: 'POST', body: '{}' })).status).toBe(401);
  });

  it('import_json（JSON body）导入后 export_json 往返一致', async () => {
    await seedUser();
    const payload = {
      type: 'onenav.bookmarks', version: 1,
      categories: [{
        name: '工具', description: '',
        links: [{ title: 'GitHub', url: 'https://github.com', description: '', backup_url: '', sort_order: 0 }],
        children: [],
      }],
    };
    const imp = await req('/api/import_json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': validToken() },
      body: JSON.stringify(payload),
    });
    const impJson = await json(imp);
    expect(impJson.code).toBe(0);
    expect(impJson.data.links_imported).toBe(1);

    const exp = await req('/api/export_json', { ...form({}), headers: { 'X-Token': validToken() } });
    const expJson = await json(exp);
    expect(expJson.data.categories[0].name).toBe('工具');
    expect(expJson.data.categories[0].links[0].url).toBe('https://github.com');
  });
});
