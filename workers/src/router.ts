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
  linkListHandler, qCategoryLinkHandler, getALinkHandler, globalSearchHandler,
} from './handlers/link';
import { publicNavHandler } from './handlers/public';
import { exportJsonHandler, importJsonHandler } from './handlers/migrate';
import { checkLoginHandler, createSkHandler, tokenInfoHandler, appInfoHandler } from './handlers/auth';
import { initHandler, loginHandler } from './handlers/init';
import { getActiveTheme, setActiveTheme, mergeManifest, DEFAULT_THEME } from './handlers/themes';
import type { ThemeManifestEntry } from './handlers/themes';
import { getSiteConfig, setSiteConfig, siteConfigData, isPrivateAndGuest } from './handlers/site';
import {
  addCategorySchema, editCategorySchema, delCategorySchema, getACategorySchema,
  addLinkSchema, editLinkSchema, delLinkSchema, getALinkSchema, qCategoryLinkSchema,
  globalSearchSchema,
  initSchema, loginSchema, setSiteSchema,
  aiConfigSchema, aiChatSchema, aiMessagesSchema, aiDelConversationSchema,
} from './lib/validate';
import {
  getAiConfigHandler, saveAiConfigHandler,
  listAiConversationsHandler, deleteAiConversationHandler, listAiMessagesHandler,
} from './handlers/ai';
import { createConversation } from './ai/conversations';

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

  // PHP 兼容入口：/index.php?c=api&method=<m>（无伪静态 URL 形态，浏览器扩展使用）。
  // 必须在全局中间件之后、具体端点之前注册（app.all('*') 伺服路由在文件末尾兜底）。
  app.all('/index.php', async c => {
    const controller = c.req.query('c');
    const method = c.req.query('method');
    if (controller === 'api' && method) {
      const url = new URL(c.req.url);
      url.pathname = `/api/${method}`;
      // 其余查询参数（page/limit/category_id 等）原样保留；form body（含 token）随 raw Request 转发
      const forwarded = new Request(url.toString(), c.req.raw);
      // ExecutionContext 双类型源（workers-types vs cf-typegen 含 tracing/abort），从 app.request 反推目标类型
      type ExecCtx = Parameters<typeof app.request>[3];
      let ec: ExecCtx | undefined;
      try { ec = c.executionCtx as ExecCtx; } catch { /* 测试环境无执行上下文 */ }
      return app.request(forwarded, undefined, c.env, ec);
    }
    return new Response(null, { status: 302, headers: { Location: '/' } });
  });

  // ---------- 公开端点（无鉴权） ----------

  app.post('/api/app_info', async c => {
    const body = await parseBody(c);
    return c.json(await appInfoHandler(c.get('db'), String(body.version ?? '0')));
  });

  app.on(['GET', 'POST'], '/api/check_login', async c => {
    const body = await parseBody(c).catch(() => ({}) as Record<string, unknown>);
    const q = c.req.query();
    const token = (body.token ? String(body.token) : undefined) ?? q.token;
    return c.json(await checkLoginHandler(c.get('db'), token));
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

  app.post('/api/logout', async c => {
    // 清除会话 cookie（Max-Age=0 立即过期）；无需鉴权——登出一个已死的会话也是幂等的
    c.header('Set-Cookie', 'key=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return c.json({ code: 0, data: null });
  });

  app.get('/api/session', async c => {
    const username = await authenticateRequest(c);
    return c.json({ code: 0, data: { username } });
  });

  app.get('/api/site_config', authMiddleware, async c => {
    return c.json({ code: 0, data: siteConfigData(await getSiteConfig(c.get('db'))) });
  });

  app.post('/api/set_site', authMiddleware, async c => {
    const body = await parseBody(c);
    const p = setSiteSchema.parse(body);
    await setSiteConfig(c.get('db'), {
      ...(p.site_private !== undefined ? { sitePrivate: p.site_private } : {}),
      ...(p.site_title !== undefined ? { siteTitle: p.site_title } : {}),
      ...(p.site_subtitle !== undefined ? { siteSubtitle: p.site_subtitle } : {}),
    });
    return c.json({ code: 0, data: siteConfigData(await getSiteConfig(c.get('db'))) });
  });

  app.get('/api/public_nav', optionalAuthMiddleware, async c => {
    // 隐私模式：游客连公开数据也不给（HTTP 语义收口在 router）
    if (await isPrivateAndGuest(c.get('db'), c.get('isAuthed'))) {
      const msg = '此站点已开启隐私模式，请先登录';
      return c.json({ code: -1002, msg, err_msg: msg }, 401);
    }
    return c.json(await publicNavHandler(c.get('db'), c.get('isAuthed')));
  });

  // ---------- 列表端点（可选鉴权：游客只见公开数据） ----------

  // 读端点开 GET（PHP $_REQUEST 不分方法；插件列表查询可能走 GET）；写操作保持 POST-only
  app.on(['GET', 'POST'], '/api/category_list', optionalAuthMiddleware, async c => {
    const q = c.req.query();
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '10', 10) || 10));
    return c.json(await categoryListHandler(c.get('db'), page, limit, c.get('isAuthed')));
  });

  app.on(['GET', 'POST'], '/api/link_list', optionalAuthMiddleware, async c => {
    const q = c.req.query();
    const body = await parseBody(c);
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '10', 10) || 10));
    const categoryId = body.category_id ? parseInt(String(body.category_id), 10) : undefined;
    const keyword = body.keyword ? String(body.keyword) : undefined;
    const property = body.property !== undefined && body.property !== null && String(body.property) !== ''
      ? parseInt(String(body.property), 10) : undefined;
    return c.json(await linkListHandler(c.get('db'), page, limit, c.get('isAuthed'), {
      categoryId: Number.isNaN(categoryId as number) ? undefined : categoryId,
      keyword,
      property: Number.isNaN(property) || property !== 0 && property !== 1 ? undefined : property,
    }));
  });

  app.on(['GET', 'POST'], '/api/q_category_link', optionalAuthMiddleware, async c => {
    const q = c.req.query();
    const body = await parseBody(c);
    const fid = parseInt(String(body.category_id ?? q.category_id ?? q.id ?? '0'), 10);
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '10', 10) || 10));
    const parsed = qCategoryLinkSchema.parse({ category_id: fid });
    return c.json(await qCategoryLinkHandler(c.get('db'), parsed.category_id, page, limit, c.get('isAuthed')));
  });

  app.on(['GET', 'POST'], '/api/get_a_category', optionalAuthMiddleware, async c => {
    const body = await parseBody(c);
    const q = c.req.query();
    const parsed = getACategorySchema.parse({ id: body.id ?? q.id });
    return c.json(await getACategoryHandler(c.get('db'), parsed.id, c.get('isAuthed')));
  });

  app.on(['GET', 'POST'], '/api/get_a_link', optionalAuthMiddleware, async c => {
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

  // 全局搜索（插件搜索框）：强制鉴权，keyword 走 body（PHP $_REQUEST 对齐）
  app.post('/api/global_search', authMiddleware, async c => {
    const body = await parseBody(c);
    const p = globalSearchSchema.parse(body);
    return c.json(await globalSearchHandler(c.get('db'), p.keyword));
  });

  app.post('/api/export_json', authMiddleware, async c => {
    return c.json(await exportJsonHandler(c.get('db')));
  });

  app.post('/api/import_json', authMiddleware, async c => {
    // 注意：本端点收 JSON body（非 FormData），与其它端点不同
    const payload = await c.req.json().catch(() => {
      throw new Error('请求体必须是 JSON');
    });
    return c.json(await importJsonHandler(c.get('db'), payload));
  });

  app.get('/api/token_info', authMiddleware, async c => {
    return c.json(await tokenInfoHandler(c.get('db')));
  });

  // ---------- 主题配置 API ----------

  async function fetchAssetsJson(c: Context<AppEnv>, path: string): Promise<unknown | null> {
    const res = await c.env.ASSETS.fetch(new Request(new URL(path, c.req.url)));
    if (!res.ok) return null;
    return res.json().catch(() => null);
  }

  function readManifestList(v: unknown): ThemeManifestEntry[] {
    return Array.isArray(v) ? v as ThemeManifestEntry[] : [];
  }

  app.get('/api/themes', authMiddleware, async c => {
    if (!c.env.ASSETS) return c.json({ code: -2000, msg: 'assets 未配置' });
    const d1 = readManifestList(await fetchAssetsJson(c, '/themes/manifest.d1.json'));   // 未来 R2 段的路径，当前不存在→null
    const assets = readManifestList(await fetchAssetsJson(c, '/themes/manifest.json'));
    return c.json({
      code: 0,
      data: { active: await getActiveTheme(c.get('db')), themes: mergeManifest(d1, assets) },
    });
  });

  app.post('/api/set_theme', authMiddleware, async c => {
    if (!c.env.ASSETS) return c.json({ code: -2000, msg: 'assets 未配置' });
    const body = await parseBody(c);
    const theme = String(body.theme ?? '');
    if (!theme) return c.json({ code: -2000, msg: 'theme 不能为空' });
    const d1 = readManifestList(await fetchAssetsJson(c, '/themes/manifest.d1.json'));
    const assets = readManifestList(await fetchAssetsJson(c, '/themes/manifest.json'));
    const known = new Set(mergeManifest(d1, assets).map(t => t.id));
    if (!known.has(theme)) return c.json({ code: -2000, msg: `未知主题：${theme}` });
    await setActiveTheme(c.get('db'), theme);
    return c.json({ code: 0, data: { active: theme } });
  });

  // ---------- AI 助手（仅管理员） ----------

  app.get('/api/ai_config', authMiddleware, async c => {
    return c.json(await getAiConfigHandler(c.get('db')));
  });

  app.post('/api/ai_config', authMiddleware, async c => {
    // JSON body（先例：import_json）——providers 数组/布尔值走 FormData 会失真
    const payload = await c.req.json().catch(() => {
      throw new Error('请求体必须是 JSON');
    });
    const parsed = aiConfigSchema.parse(payload);
    return c.json(await saveAiConfigHandler(c.get('db'), parsed));
  });

  app.get('/api/ai_conversations', authMiddleware, async c => {
    return c.json(await listAiConversationsHandler(c.get('db')));
  });

  app.post('/api/ai_del_conversation', authMiddleware, async c => {
    const body = await parseBody(c);
    const p = aiDelConversationSchema.parse(body);
    return c.json(await deleteAiConversationHandler(c.get('db'), p.id));
  });

  app.get('/api/ai_messages', authMiddleware, async c => {
    const p = aiMessagesSchema.parse({ cid: c.req.query('cid'), token: c.req.query('token') });
    return c.json(await listAiMessagesHandler(c.get('db'), p.cid));
  });

  // SSE 主端点:鉴权+Zod 在此;执行转发给会话专属 DO(断连续跑/重挂续流,见 do/AgentTurnDO.ts)。
  // cid=0 时预建会话(DO id 需要确定 cid);agent 的 conversation 事件会把 cid 带给前端。
  app.post('/api/ai_chat', authMiddleware, async c => {
    const body = await parseBody(c);
    const p = aiChatSchema.parse(body);
    const db = c.get('db');
    let cid = p.cid;
    if (!cid) {
      const conv = await createConversation(db, '');
      cid = conv.id;
    }
    const stub = c.env.AGENT.get(c.env.AGENT.idFromName(`conv-${cid}`));
    return stub.fetch('https://agent-do/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cid,
        ...(p.message !== undefined ? { message: p.message } : {}),
        ...(p.confirm_message_id ? { confirm: { messageId: p.confirm_message_id, action: p.confirm_action ?? 'approve' } } : {}),
      }),
    });
  });

  // 重挂:running 时回放本回合事件流并实时续流;否则 hello+done 即关(前端以 DB 为准)
  app.get('/api/ai_events', authMiddleware, async c => {
    const p = aiMessagesSchema.parse({ cid: c.req.query('cid'), token: c.req.query('token') });
    const stub = c.env.AGENT.get(c.env.AGENT.idFromName(`conv-${p.cid}`));
    return stub.fetch('https://agent-do/events');
  });

  // 停止:服务端 abort(断开连接不再有停止语义);幂等
  app.post('/api/ai_stop', authMiddleware, async c => {
    const body = await parseBody(c);
    const p = aiMessagesSchema.parse(body);
    const stub = c.env.AGENT.get(c.env.AGENT.idFromName(`conv-${p.cid}`));
    const res = await stub.fetch('https://agent-do/stop', { method: 'POST' });
    return c.json(await res.json());
  });

  // ---------- 伺服路由（放最后） ----------

  function assetReq(c: Context<AppEnv>, path: string): Request {
    return new Request(new URL(path, c.req.url));
  }

  app.all('*', async c => {
    const path = c.req.path;

    // API 未知方法：JSON 404（既有行为；err_msg 插件读取）
    if (path.startsWith('/api/')) {
      return c.json({ code: -404, msg: 'method not found!', err_msg: 'method not found!' }, 404);
    }

    if (!c.env.ASSETS) {
      return c.text('assets not configured (build first: pnpm build)', 500);
    }

    // 主题资产 / 根公共资产：直出
    if (path.startsWith('/themes/') || path === '/favicon.svg' || path === '/favicon.ico' || path === '/robots.txt') {
      return c.env.ASSETS.fetch(assetReq(c, path));
    }

    // 管理壳：直出，非 ok（含 404/500）回落 SPA index（深链）；
    // 真实 binding 对"目录在 index 缺"返回 500 而非 404，故用 ok 判定
    if (path === '/admin' || path.startsWith('/admin/') || path === '/login' || path === '/init') {
      const res = await c.env.ASSETS.fetch(assetReq(c, path));
      if (res.ok) return res;
      return c.env.ASSETS.fetch(assetReq(c, '/admin/index.html'));
    }

    // 首页：当前主题（降级链：配置主题 → compass → 302 /admin）
    if (path === '/') {
      // 隐私模式：未登录先跳登录（主题 HTML 也不给看）
      if (await isPrivateAndGuest(c.get('db'), false)) {
        const user = await authenticateRequest(c);
        if (!user) {
          return new Response(null, { status: 302, headers: { Location: '/admin/login?redirect=%2F' } });
        }
      }

      const manifest = readManifestList(await fetchAssetsJson(c, '/themes/manifest.json'));
      const ids = new Set(manifest.map(t => t.id));
      let active = await getActiveTheme(c.get('db'));
      if (!ids.has(active)) {
        console.warn(`theme "${active}" not in manifest, falling back to ${DEFAULT_THEME}`);
        active = DEFAULT_THEME;
      }
      if (active === DEFAULT_THEME || ids.has(active)) {
        const res = await c.env.ASSETS.fetch(assetReq(c, `/themes/${active}/index.html`));
        if (res.ok) return res;
        console.warn(`theme "${active}" entry missing`);
        if (active !== DEFAULT_THEME) {
          const fb = await c.env.ASSETS.fetch(assetReq(c, `/themes/${DEFAULT_THEME}/index.html`));
          if (fb.ok) return fb;
        }
      }
      // compass 也没有（异常部署）→ 管理壳；不能 302 到 / 自环
      return new Response(null, { status: 302, headers: { Location: '/admin' } });
    }

    // 其余未知路径
    return new Response(null, { status: 302, headers: { Location: '/' } });
  });

  return app;
}
