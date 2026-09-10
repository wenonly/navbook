import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from './types';
import { getDb } from './db/client';
import { corsMiddleware } from './middleware/cors';
import { authMiddleware, optionalAuthMiddleware, authenticateRequest } from './middleware/auth';
import { onErrorHandler } from './middleware/error';
import {
  addCategoryHandler, editCategoryHandler, delCategoryHandler,
  categoryListHandler, getACategoryHandler,
} from './handlers/category';
import {
  addLinkHandler, editLinkHandler, delLinkHandler,
  linkListHandler, qCategoryLinkHandler, getALinkHandler,
} from './handlers/link';
import { publicNavHandler } from './handlers/public';
import { checkLoginHandler, createSkHandler, appInfoHandler } from './handlers/auth';
import { initHandler, loginHandler } from './handlers/init';
import {
  addCategorySchema, editCategorySchema, delCategorySchema, getACategorySchema,
  addLinkSchema, editLinkSchema, delLinkSchema, getALinkSchema, qCategoryLinkSchema,
  initSchema, loginSchema,
} from './lib/validate';

/** body 解析统一入口：非法/缺失 body 一律落空对象，交给 Zod 报具体字段错误 */
async function parseBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  return await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
}

export function createApp() {
  const app = new Hono<AppEnv>();

  // 错误出口必须用 onError 注册（compose 在抛错层就地调用，不会冒泡到中间件 catch）
  app.onError(onErrorHandler);
  app.use('*', corsMiddleware);
  app.use('*', async (c, next) => {
    c.set('db', getDb(c.env.DB));
    c.set('isAuthed', false);
    c.set('username', null);
    await next();
  });

  // ---------- 公开端点（无鉴权） ----------

  app.post('/api/app_info', async c => {
    const body = await parseBody(c);
    return c.json(await appInfoHandler(c.get('db'), String(body.version ?? '0')));
  });

  app.post('/api/check_login', async c => {
    const body = await parseBody(c);
    return c.json(await checkLoginHandler(c.get('db'), body.token ? String(body.token) : undefined));
  });

  app.post('/api/init', async c => {
    const body = await parseBody(c);
    const parsed = initSchema.parse({ username: body.username, password: body.password });
    return c.json(await initHandler(c.get('db'), parsed.username, parsed.password));
  });

  app.post('/api/login', async c => {
    const body = await parseBody(c);
    const parsed = loginSchema.parse({ password: body.password });
    const result = await loginHandler(c.get('db'), parsed.password, c.req.header('User-Agent') ?? '');
    if (result.code === 0 && result.data) {
      c.header('Set-Cookie',
        `key=${result.data.cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
      // 响应体剥离 cookie 值（只走 Set-Cookie 头），HttpOnly 才有意义
      return c.json({ code: 0, data: { username: result.data.username } });
    }
    return c.json(result);
  });

  app.get('/api/session', async c => {
    const username = await authenticateRequest(c);
    return c.json({ code: 0, data: { username } });
  });

  app.get('/api/public_nav', async c => {
    return c.json(await publicNavHandler(c.get('db')));
  });

  // ---------- 列表端点（可选鉴权：游客只见公开数据） ----------

  app.post('/api/category_list', optionalAuthMiddleware, async c => {
    const q = c.req.query();
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '10', 10) || 10));
    return c.json(await categoryListHandler(c.get('db'), page, limit, c.get('isAuthed')));
  });

  app.post('/api/link_list', optionalAuthMiddleware, async c => {
    const q = c.req.query();
    const body = await parseBody(c);
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '10', 10) || 10));
    const categoryId = body.category_id ? parseInt(String(body.category_id), 10) : undefined;
    return c.json(await linkListHandler(c.get('db'), page, limit, c.get('isAuthed'), categoryId));
  });

  app.post('/api/q_category_link', optionalAuthMiddleware, async c => {
    const q = c.req.query();
    const body = await parseBody(c);
    const fid = parseInt(String(body.category_id ?? q.category_id ?? q.id ?? '0'), 10);
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '10', 10) || 10));
    const parsed = qCategoryLinkSchema.parse({ category_id: fid });
    return c.json(await qCategoryLinkHandler(c.get('db'), parsed.category_id, page, limit, c.get('isAuthed')));
  });

  app.post('/api/get_a_category', optionalAuthMiddleware, async c => {
    const body = await parseBody(c);
    const q = c.req.query();
    const parsed = getACategorySchema.parse({ id: body.id ?? q.id });
    return c.json(await getACategoryHandler(c.get('db'), parsed.id, c.get('isAuthed')));
  });

  app.post('/api/get_a_link', optionalAuthMiddleware, async c => {
    const q = c.req.query();
    const body = await parseBody(c);
    const parsed = getALinkSchema.parse({ id: body.id ?? q.id });
    return c.json(await getALinkHandler(c.get('db'), parsed.id, c.get('isAuthed')));
  });

  // ---------- 写操作（强制鉴权） ----------

  app.post('/api/add_category', authMiddleware, async c => {
    const body = await parseBody(c);
    const p = addCategorySchema.parse(body);
    return c.json(await addCategoryHandler(c.get('db'), {
      name: p.name, property: p.property, weight: p.weight,
      description: p.description, font_icon: p.font_icon, fid: p.fid,
    }));
  });

  app.post('/api/edit_category', authMiddleware, async c => {
    const body = await parseBody(c);
    const p = editCategorySchema.parse(body);
    return c.json(await editCategoryHandler(c.get('db'), p.id, {
      name: p.name, property: p.property, weight: p.weight,
      description: p.description, font_icon: p.font_icon, fid: p.fid,
    }));
  });

  app.post('/api/del_category', authMiddleware, async c => {
    const body = await parseBody(c);
    const p = delCategorySchema.parse(body);
    return c.json(await delCategoryHandler(c.get('db'), p.id));
  });

  app.post('/api/add_link', authMiddleware, async c => {
    const body = await parseBody(c);
    const p = addLinkSchema.parse(body);
    return c.json(await addLinkHandler(c.get('db'), {
      fid: p.fid, title: p.title, url: p.url, description: p.description,
      weight: p.weight, property: p.property, url_standby: p.url_standby, font_icon: p.font_icon,
    }));
  });

  app.post('/api/edit_link', authMiddleware, async c => {
    const body = await parseBody(c);
    const p = editLinkSchema.parse(body);
    return c.json(await editLinkHandler(c.get('db'), p.id, {
      fid: p.fid, title: p.title, url: p.url, description: p.description,
      weight: p.weight, property: p.property, url_standby: p.url_standby, font_icon: p.font_icon,
    }));
  });

  app.post('/api/del_link', authMiddleware, async c => {
    const body = await parseBody(c);
    const p = delLinkSchema.parse(body);
    return c.json(await delLinkHandler(c.get('db'), p.id));
  });

  app.post('/api/create_sk', authMiddleware, async c => {
    return c.json(await createSkHandler(c.get('db')));
  });

  // ---------- SPA fallback（放最后） ----------

  app.all('*', async c => {
    if (c.req.path.startsWith('/api/')) {
      // 未知 /api 方法返回 JSON 404，不落 SPA fallback
      return c.json({ code: -404, msg: 'method not found!' }, 404);
    }
    // ASSETS 绑定到 Task 19（assets binding）才存在，之前判空防护
    if (!c.env.ASSETS) {
      return c.text('SPA assets not configured (deploy task pending)', 404);
    }
    return c.env.ASSETS.fetch(c.req.raw);
  });

  return app;
}
