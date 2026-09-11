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

// fake ASSETS：内存文件表模拟 Workers Assets binding（真绑定在 vitest-pool-workers 里不可用）
function makeFakeAssets() {
  const files = new Map<string, string>([
    ['/admin/index.html', '<html>ADMIN_SHELL</html>'],
    ['/themes/manifest.json', JSON.stringify([
      { id: 'default2', name: 'Default 2', version: '1.0.0', author: 't', description: '', minAppVersion: '1.0.0' },
      { id: 'minima', name: 'Minima', version: '1.0.0', author: 't', description: '', minAppVersion: '1.0.0' },
      { id: 'broken', name: 'Broken', version: '1.0.0', author: 't', description: '', minAppVersion: '1.0.0' },
    ])],
    ['/themes/default2/index.html', '<html>THEME_DEFAULT2</html>'],
    ['/themes/minima/index.html', '<html>THEME_MINIMA</html>'],
    ['/themes/default2/assets/app.js', 'console.log(1)'],
    ['/favicon.svg', '<svg/>'],
  ]);
  return {
    fetch: (req: Request) => {
      const path = new URL(req.url).pathname;
      // 模拟真实 assets binding（wrangler 4.130, html_handling="none"）：
      // 请求"存在的目录 + 缺失的 index.html"返回 500 而非 404
      if (path === '/themes/broken/index.html') {
        return Promise.resolve(new Response('asset error', { status: 500 }));
      }
      const body = files.get(path);
      const type = path.endsWith('.json') ? 'application/json'
        : path.endsWith('.html') ? 'text/html'
        : path.endsWith('.svg') ? 'image/svg+xml' : 'application/javascript';
      return Promise.resolve(new Response(body ?? null, { status: body ? 200 : 404, headers: { 'Content-Type': type } }));
    },
  } as unknown as Fetcher;
}

// testEnv：与 auth.test.ts 相同的 cast 模式（类型上缺 Task 19 的 ASSETS，运行时齐全）
const testEnv = { ...env, ASSETS: makeFakeAssets() } as unknown as import('../src/types').AppEnv['Bindings'];

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

  it('token 走 query 参数通过鉴权（PHP $_REQUEST 兼容）', async () => {
    await seedUser();
    const res = await req(`/api/category_list?token=${validToken()}&page=1&limit=10`);
    expect(res.status).toBe(200);
  });

  it('token 走 form body 通过鉴权（无 X-Token header）', async () => {
    await seedUser();
    const res = await req('/api/add_category', form({ name: '体感', token: validToken() }));
    const json = await res.json() as any;
    expect(json.code).toBe(0);
  });

  it('check_login 返回 PHP 原版形状（code 200 + data "true"）', async () => {
    await seedUser();
    const res = await req(`/api/check_login?token=${validToken()}`);
    const json = await res.json() as any;
    expect(json.code).toBe(200);
    expect(json.data).toBe('true');
    expect(json.msg).toBe('success');
  });

  it('check_login 支持 GET；错误 token 返回 -1002', async () => {
    await seedUser();
    expect((await req('/api/check_login?token=bad', { method: 'GET' })).status).toBe(200); // 200 + code -1002
    const bad = await (await req('/api/check_login?token=bad', { method: 'GET' })).json() as any;
    expect(bad.code).toBe(-1002);
  });

  it('列表端点支持 GET（query token + query 分页）', async () => {
    await seedUser();
    const res = await req(`/api/link_list?page=1&limit=10&token=${validToken()}`);
    expect(res.status).toBe(200);
  });

  it('中间件 parseBody 与 handler parseBody 共存（bodyCache）', async () => {
    await seedUser();
    // add_link 的 handler 也 parseBody 读 fid/title——token 在 body，中间件先 parse 后 handler 再 parse
    // 先建分类拿真实 id（sqlite_sequence 跨 DELETE 存活，不得假定 id=1）
    const cat = await (await req('/api/add_category', form({ name: '缓存前置', token: validToken() }))).json() as any;
    const res = await req('/api/add_link', form({
      token: validToken(), fid: String(cat.id), title: '缓存验证', url: 'https://cache.test',
    }));
    const json = await res.json() as any;
    expect(json.code).toBe(0);
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

  it('public_nav 带 X-Token 返回私有数据', async () => {
    await seedUser();
    await req('/api/add_category', { ...form({ name: '私有', property: '1' }), headers: { 'X-Token': validToken() } });
    const guest = await (await req('/api/public_nav')).json() as any;
    expect(guest.data.categories).toEqual([]);
    const admin = await (await req('/api/public_nav', { headers: { 'X-Token': validToken() } })).json() as any;
    expect(admin.data.categories[0].private).toBe(true);
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

  it('logout 清除会话 cookie', async () => {
    await seedUser();
    await req('/api/login', form({ password: 'test123' }));

    const out = await req('/api/logout', { method: 'POST' });
    const setCookie = out.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('key=');
    expect(setCookie).toContain('Max-Age=0');
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

  it('/ 返回当前主题 HTML（缺省 default2）', async () => {
    const res = await req('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('THEME_DEFAULT2');
  });

  it('set_theme 切换后 / 即刻返回新主题（需鉴权）', async () => {
    await seedUser();
    const noAuth = await req('/api/set_theme', form({}));
    expect(noAuth.status).toBe(401);

    await req('/api/set_theme', { ...form({ theme: 'minima' }), headers: { 'X-Token': validToken() } });
    const home = await req('/');
    expect(await home.text()).toContain('THEME_MINIMA');
  });

  it('set_theme 校验 manifest，未知主题拒绝', async () => {
    await seedUser();
    const res = await req('/api/set_theme', { ...form({ theme: 'nope' }), headers: { 'X-Token': validToken() } });
    const json = await res.json() as any;
    expect(json.code).not.toBe(0);
  });

  it('GET /api/themes 需鉴权并返回 active+列表', async () => {
    await seedUser();
    expect((await req('/api/themes')).status).toBe(401);
    const res = await req('/api/themes', { headers: { 'X-Token': validToken() } });
    const json = await res.json() as any;
    expect(json.data.active).toBe('default2');
    expect(json.data.themes.map((t: any) => t.id)).toContain('minima');
  });

  it('/admin 深链 404 回落 admin SPA', async () => {
    const res = await req('/admin/links');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('ADMIN_SHELL');
  });

  it('主题资产直出 + 未知路径 302 /', async () => {
    expect((await req('/themes/default2/assets/app.js')).status).toBe(200);
    const unknown = await req('/whatever');
    expect(unknown.status).toBe(302);
    expect(unknown.headers.get('Location')).toBe('/');
  });

  it('active 指向不在 manifest 的主题时回落 default2', async () => {
    await env.DB.prepare("INSERT OR REPLACE INTO on_options (key, value) VALUES ('s_themes', ?)")
      .bind('{"active":"ghost"}').run();
    const res = await req('/');
    expect(await res.text()).toContain('THEME_DEFAULT2');
  });

  it('主题 entry 返回 500 时回落 default2（真实 assets 行为回归）', async () => {
    await seedUser();
    await env.DB.prepare("INSERT OR REPLACE INTO on_options (key, value) VALUES ('s_themes', ?)")
      .bind('{"active":"broken"}').run();
    const res = await req('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('THEME_DEFAULT2');
  });

  it('site_config/set_site：读取与写入往返（需鉴权）', async () => {
    await seedUser();
    expect((await req('/api/site_config')).status).toBe(401);
    expect((await req('/api/set_site', form({ site_private: '1' }))).status).toBe(401);
    const before = await (await req('/api/site_config', { headers: { 'X-Token': validToken() } })).json() as any;
    expect(before.data.site_private).toBe(false);
    expect(before.data.site_title).toBe('NavBook');
    expect(before.data.site_subtitle).toBe('');

    await req('/api/set_site', {
      ...form({ site_private: '1', site_title: '我的导航', site_subtitle: 'sub' }),
      headers: { 'X-Token': validToken() },
    });
    const after = await (await req('/api/site_config', { headers: { 'X-Token': validToken() } })).json() as any;
    expect(after.data.site_private).toBe(true);
    expect(after.data.site_title).toBe('我的导航');
    expect(after.data.site_subtitle).toBe('sub');
  });

  it('隐私模式：public_nav 游客 401，鉴权后正常', async () => {
    await seedUser();
    await req('/api/set_theme', { ...form({ theme: 'default2' }), headers: { 'X-Token': validToken() } });
    await req('/api/set_site', { ...form({ site_private: '1' }), headers: { 'X-Token': validToken() } });

    const guest = await req('/api/public_nav');
    expect(guest.status).toBe(401);

    const authed = await req('/api/public_nav', { headers: { 'X-Token': validToken() } });
    expect(authed.status).toBe(200);

    // 关闭后恢复
    await req('/api/set_site', { ...form({ site_private: '0' }), headers: { 'X-Token': validToken() } });
    expect((await req('/api/public_nav')).status).toBe(200);
  });

  it('global_search：关键词匹配标题/URL/描述并带 category_name', async () => {
    await seedUser();
    await req('/api/add_category', { ...form({ name: '搜索分类' }), headers: { 'X-Token': validToken() } });
    const cat = await (await req('/api/category_list?page=1&limit=10', { headers: { 'X-Token': validToken() } })).json() as any;
    const fid = cat.data[0].id;
    await req('/api/add_link', { ...form({ fid: String(fid), title: 'GitHub 主页', url: 'https://github.com/x', description: '代码托管' }), headers: { 'X-Token': validToken() } });

    const hit = await (await req('/api/global_search', { ...form({ keyword: 'GitHub' }), headers: { 'X-Token': validToken() } })).json() as any;
    expect(hit.code).toBe(0);
    expect(hit.data.length).toBe(1);
    expect(hit.data[0].title).toBe('GitHub 主页');
    expect(hit.data[0].category_name).toBe('搜索分类');

    const byDesc = await (await req('/api/global_search', { ...form({ keyword: '托管' }), headers: { 'X-Token': validToken() } })).json() as any;
    expect(byDesc.data.length).toBe(1);

    const miss = await (await req('/api/global_search', { ...form({ keyword: '不存在的词' }), headers: { 'X-Token': validToken() } })).json() as any;
    expect(miss.code).toBe(0);
    expect(miss.data).toEqual([]);
  });

  it('global_search：关键词长度与鉴权', async () => {
    await seedUser();
    expect((await req('/api/global_search', form({ keyword: 'xx' }))).status).toBe(401);
    const short = await (await req('/api/global_search', { ...form({ keyword: 'x' }), headers: { 'X-Token': validToken() } })).json() as any;
    expect(short.code).toBe(-2000);
    const long = await (await req('/api/global_search', { ...form({ keyword: 'x'.repeat(33) }), headers: { 'X-Token': validToken() } })).json() as any;
    expect(long.code).toBe(-2000);
  });

  it('/index.php 兼容入口：POST form token 走通 check_login 与 category_list', async () => {
    await seedUser();
    const check = await req('/index.php?c=api&method=check_login', form({ token: validToken() }));
    const checkJson = await check.json() as any;
    expect(checkJson.code).toBe(200);

    const list = await req('/index.php?c=api&method=category_list&page=1&limit=999', form({ token: validToken() }));
    const listJson = await list.json() as any;
    expect(listJson.code).toBe(0);
    expect(typeof listJson.count).toBe('number');
  });

  it('错误响应带 err_msg 字段（插件读取）', async () => {
    await seedUser();
    const bad = await req('/api/check_login', form({ token: 'bad' }));
    const json = await bad.json() as any;
    expect(json.err_msg).toBe('Authorization failure!');
  });

  it('隐私模式：/ 游客 302 登录页，登录 cookie 后正常出主题', async () => {
    await seedUser();
    await req('/api/set_site', { ...form({ site_private: '1' }), headers: { 'X-Token': validToken() } });

    const guest = await req('/');
    expect(guest.status).toBe(302);
    expect(guest.headers.get('Location')).toContain('/admin/login');

    // X-Token 不能用于 / 伺服路由（那是 API 头）；用 login 拿 cookie 走 /
    // login 与 / 的 UA 必须一致（cookie 公式绑定 UA）
    const login = await req('/api/login', {
      ...form({ password: 'test123' }),
      headers: { 'User-Agent': 'privacy-test' },
    });
    const cookieVal = login.headers.get('Set-Cookie')!.match(/key=([^;]+)/)![1];
    const home = await req('/', { headers: { Cookie: `key=${cookieVal}`, 'User-Agent': 'privacy-test' } });
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('THEME_');
  });
});
