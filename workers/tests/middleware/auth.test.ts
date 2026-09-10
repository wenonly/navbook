import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { env } from 'cloudflare:test';
import { authMiddleware, optionalAuthMiddleware, authenticate } from '../../src/middleware/auth';
import { getDb } from '../../src/db/client';
import type { AppEnv } from '../../src/types';
import { resetTables, seedUser, validToken, validCookie } from '../helpers';

// workers-types 的 Response.json() 返回 Promise<unknown>，统一在此断言
async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

// authMiddleware 读 c.env.USERNAME，app.request 必须带 env；测试 env 运行时含
// wrangler.toml 的 USERNAME，只是类型上缺 Task 19 才生成的 ASSETS，故 cast。
const testEnv = env as unknown as AppEnv['Bindings'];

function req(app: Hono<AppEnv>, path: string, init?: RequestInit): Response | Promise<Response> {
  return app.request(path, init, testEnv);
}

beforeEach(async () => {
  await resetTables();
  await seedUser();
});

function makeApp() {
  // 模拟 router 里的 db 注入中间件（Task 12 会由真实 router 提供）
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('db', getDb(env.DB));
    c.set('isAuthed', false);
    c.set('username', null);
    await next();
  });
  app.use('/protected/*', authMiddleware);
  app.get('/protected/ping', (c) => c.json({ ok: true }));
  return app;
}

describe('authenticate', () => {
  it('合法 X-Token 返回 username', async () => {
    const name = await authenticate(getDb(env.DB), 'admin', validToken(), undefined, 'ua');
    expect(name).toBe('admin');
  });

  it('合法 cookie（含 UA）返回 username', async () => {
    const ua = 'vitest-ua';
    const cookie = validCookie(ua);
    const name = await authenticate(getDb(env.DB), 'admin', undefined, cookie, ua);
    expect(name).toBe('admin');
  });

  it('UA 不匹配时 cookie 失败', async () => {
    const cookie = validCookie('other-ua');
    const name = await authenticate(getDb(env.DB), 'admin', undefined, cookie, 'vitest-ua');
    expect(name).toBeNull();
  });

  it('无凭据返回 null', async () => {
    const name = await authenticate(getDb(env.DB), 'admin', undefined, undefined, 'ua');
    expect(name).toBeNull();
  });
});

describe('authMiddleware', () => {
  it('合法 X-Token 放行', async () => {
    const res = await req(makeApp(),'/protected/ping', {
      headers: { 'X-Token': validToken() },
    });
    expect(res.status).toBe(200);
    expect((await json(res)).ok).toBe(true);
  });

  it('无凭据返回 401 + code -1002', async () => {
    const res = await req(makeApp(),'/protected/ping');
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe(-1002);
  });

  it('非法 X-Token 且无 cookie 返回 401', async () => {
    const res = await req(makeApp(),'/protected/ping', {
      headers: { 'X-Token': 'bad' },
    });
    expect(res.status).toBe(401);
  });

  it('非法 X-Token 但合法 cookie 放行（回落逻辑）', async () => {
    const ua = 'vitest-ua';
    const cookie = validCookie(ua);
    const res = await req(makeApp(),'/protected/ping', {
      headers: { 'X-Token': 'bad', 'User-Agent': ua, Cookie: `key=${cookie}` },
    });
    expect(res.status).toBe(200);
  });
});

describe('optionalAuthMiddleware', () => {
  function makeOptionalApp() {
    const app = makeApp();
    app.use('/public/*', optionalAuthMiddleware);
    app.get('/public/whoami', (c) => c.json({ isAuthed: c.get('isAuthed'), username: c.get('username') }));
    return app;
  }

  it('合法 X-Token 时 isAuthed=true 且 username 注入', async () => {
    const res = await req(makeOptionalApp(),'/public/whoami', {
      headers: { 'X-Token': validToken() },
    });
    const body = await json(res);
    expect(body.isAuthed).toBe(true);
    expect(body.username).toBe('admin');
  });

  it('无凭据不拒绝，isAuthed=false username=null（游客可见公开数据）', async () => {
    const res = await req(makeOptionalApp(),'/public/whoami');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.isAuthed).toBe(false);
    expect(body.username).toBeNull();
  });
});
