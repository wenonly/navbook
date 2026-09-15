# AI 助手实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 navbook 增加 AI 聊天助手:后台配置多厂商 API key(OpenAI 兼容),管理端聊天页 + 主题页登录态气泡,agent 工具调用直连现有 handler,SSE 流式(含 ReAct 思考流),写操作人工确认,会话 D1 持久化。

**Architecture:** workers 新增 `src/ai/` 模块(config/provider/tools/conversations/agent 五件套,单向依赖:agent→provider+tools+conversations,tools→既有 handlers,互不反向依赖);SSE 端点在 router 层组装;聊天核心状态机放 `@navbook/shared`(纯 TS,UI 无关),web 与 compass 只写 UI 壳;协议类型在 workers 与 shared 两侧镜像(线缆契约,注释互指)。

**Tech Stack:** Hono 4(streamSSE)/ drizzle + D1 / Zod 4 / React 19 + shadcn(web)/ React 19 + Tailwind(compass)/ vitest 4(vitest-pool-workers)

**Spec:** `docs/superpowers/specs/2026-09-15-ai-assistant-design.md`

---

## 文件职责地图(低耦合边界)

```
workers/src/ai/
  types.ts          线缆事件/存储内容/Provider 接口(镜像 shared/src/chat/types.ts,注释互指)
  config.ts         s_ai 读写 + 预设表 + apiKey 打码/合并(不依赖本模块其它文件)
  conversations.ts  会话/消息 CRUD(只依赖 db,不知道 agent 存在)
  provider.ts       OpenAI 兼容流式客户端(可注入 fetch;不知道 tools/agent)
  tools.ts          工具注册表(execute 直调 handlers/*;不知道 provider/agent)
  agent.ts          循环编排(依赖上述四件的接口;emit 回调输出,不碰 HTTP)
workers/src/handlers/ai.ts   薄 handler 层(惯例:纯函数 (db,...)=>result)
workers/src/router.ts        端点注册 + SSE 流式胶水(路由层职责)
workers/src/db/migrations/0001_ai_conversations.sql + db/schema.ts(同 commit)
shared/src/chat/{types,sse,machine}.ts   线缆类型/SSE 解析/状态机(纯 TS,不依赖 react)
web/src/routes/Admin/{AiConfig,Assistant}.tsx + web/src/components/assistant/*
themes/compass/src/components/AssistantBubble.tsx
```

依赖方向(禁止反向):`router → handlers/ai → ai/agent → {ai/provider, ai/tools, ai/conversations, ai/config}`;`ai/tools → handlers/{link,category,site}`。

测试命令速查:
- workers: `pnpm --filter @navbook/workers exec vitest run <file>`(测试库自动应用 migrations,无需手动 apply)
- shared: `pnpm --filter @navbook/shared exec vitest run <file>`
- 前端验证: `pnpm --filter web build` / `pnpm --filter @navbook/theme-compass build`(tsc + vite build 即类型检查)

既有事实(写代码前不要重新推导):
- handler 纯函数惯例:`(db: DB, ...) => {code,...}`,业务错误 `throw new Error('中文文案')`(app.onError 转 `{code:-2000}`)
- 测试:每个测试文件 `beforeEach(resetTables())`,seed 用 `seedUser()`,cookie 鉴权用 `validCookie(ua)` + 同值 `User-Agent` 头;禁止断言绝对自增 id
- FormData 端点 `parseBody()` + Zod(`token: z.string().optional()` 必带);配置保存走 JSON body(先例:import_json)
- web 页面套路:`routes/Admin/*.tsx` + `App.tsx` 注册 Route + `Layout.tsx` NAV_SECTIONS + `api/client.ts` 方法
- compass 组件 default export;`useSession()` 已在 `App.tsx` 顶层调用并逐层传 `session` prop
- shared `createApiClient` 目前只有 `get`;本计划为其补一个 FormData `post`(Task 15)

---

## Phase 1 配置链路

### Task 1: workers `ai/config.ts` — s_ai 存取 + 预设表 + 打码

**Files:**
- Create: `workers/src/ai/config.ts`
- Create: `workers/src/ai/types.ts`(本任务只写配置相关类型)
- Test: `workers/tests/ai/config.test.ts`

- [x] **Step 1: 写失败测试**

```ts
// workers/tests/ai/config.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { resetTables } from '../helpers';
import {
  AI_PRESETS, DEFAULT_AI_CONFIG, loadAiConfig, saveAiConfig, maskConfig,
  resolveActiveProvider, mergeMaskedKeys,
} from '../../src/ai/config';

beforeEach(async () => { await resetTables(); });
const db = () => getDb(env.DB);

const full = {
  providers: [{
    id: 'p1', name: 'DeepSeek', preset: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-secret-1234',
    model: 'deepseek-chat', enabled: true,
  }],
  activeProviderId: 'p1',
  systemPrompt: '',
};

describe('ai config', () => {
  it('未配置时返回默认空配置', async () => {
    expect(await loadAiConfig(db())).toEqual(DEFAULT_AI_CONFIG);
  });

  it('保存后可读回', async () => {
    await saveAiConfig(db(), full);
    expect(await loadAiConfig(db())).toEqual(full);
  });

  it('maskConfig 打码 apiKey 只留尾4位', () => {
    const masked = maskConfig(full);
    expect(masked.providers[0].apiKey).toBe('sk-***1234');
    expect(masked.providers[0].model).toBe('deepseek-chat');
  });

  it('mergeMaskedKeys:打码占位保留原 key,新值覆盖', async () => {
    await saveAiConfig(db(), full);
    const existing = await loadAiConfig(db());
    const incoming = {
      ...full,
      providers: [{
        ...full.providers[0],
        apiKey: 'sk-***1234',            // 回显的打码值 → 不覆盖
        model: 'deepseek-reasoner',       // 普通字段照常覆盖
      }],
    };
    const merged = mergeMaskedKeys(existing, incoming);
    expect(merged.providers[0].apiKey).toBe('sk-secret-1234');
    expect(merged.providers[0].model).toBe('deepseek-reasoner');
    // 真实新 key(不含 ***)直接覆盖
    const rotated = mergeMaskedKeys(existing, {
      ...full, providers: [{ ...full.providers[0], apiKey: 'sk-new-5678' }],
    });
    expect(rotated.providers[0].apiKey).toBe('sk-new-5678');
  });

  it('resolveActiveProvider:取启用中的激活厂商', async () => {
    await saveAiConfig(db(), full);
    const got = resolveActiveProvider(await loadAiConfig(db()))!;
    expect(got.id).toBe('p1');
    // 激活厂商被禁用 → null
    await saveAiConfig(db(), {
      ...full, providers: [{ ...full.providers[0], enabled: false }],
    });
    expect(resolveActiveProvider(await loadAiConfig(db()))).toBeNull();
    expect(resolveActiveProvider(DEFAULT_AI_CONFIG)).toBeNull();
  });

  it('预设表含关键厂商且自定义项存在', () => {
    const ids = AI_PRESETS.map(p => p.id);
    for (const need of ['deepseek', 'qwen', 'openai', 'custom']) expect(ids).toContain(need);
    expect(AI_PRESETS.find(p => p.id === 'custom')!.baseUrl).toBe('');
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/config.test.ts`
Expected: FAIL(模块不存在)

- [x] **Step 3: 实现**

```ts
// workers/src/ai/types.ts
// 本文件是 workers 侧的 AI 类型集合。ChatSseEvent / 消息内容 DTO 与
// shared/src/chat/types.ts 是线缆契约的两侧镜像,改一处必改另一处。
import type { DB } from '../db/client';

/** s_ai.providers 条目(存储态,apiKey 明文——先例:SecretKey 存 on_options) */
export interface AiProviderConfig {
  id: string;
  name: string;
  preset: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export interface AiConfig {
  providers: AiProviderConfig[];
  activeProviderId: string | null;
  systemPrompt: string;
}

/** 下发给前端的预设厂商(baseUrl/models 自动填充用) */
export interface AiPreset {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
}

// ---- SSE 线缆事件(镜像 shared/src/chat/types.ts ChatSseEvent) ----
export type ChatSseEvent =
  | { type: 'conversation'; cid: number; title: string }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown; danger: 'read' | 'write' }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string; data: unknown }
  | { type: 'confirm_required'; messageId: number; id: string; name: string; args: unknown; summary: string }
  | { type: 'done'; messageIds: number[] }
  | { type: 'error'; code: number; msg: string };

// ---- on_ai_messages.content 的 JSON 形状(镜像 shared ChatMsgContent) ----
export interface UserMsgContent { text: string }
export interface AssistantMsgContent {
  text: string;
  reasoning: string;
  toolCalls: Array<{ id: string; name: string; args: unknown }>;
}
export type ToolStatus = 'ok' | 'error' | 'pending' | 'rejected';
export interface ToolMsgContent {
  toolCallId: string;
  name: string;
  args: unknown;
  status: ToolStatus;
  summary: string;
  result: unknown;
}
export type ChatMsgContent = UserMsgContent | AssistantMsgContent | ToolMsgContent;

// ---- Provider 抽象(agent 只见接口,测试注入 Fake) ----
export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export type ProviderStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; call: { id: string; name: string; args: string } } // 已拼装完整
  | { type: 'finish'; reason: string };

export interface ProviderClient {
  streamChat(p: {
    baseUrl: string; apiKey: string; model: string;
    messages: ProviderMessage[]; tools?: unknown[]; signal?: AbortSignal;
  }): AsyncGenerator<ProviderStreamEvent>;
}

export type WorkerDB = DB;
```

```ts
// workers/src/ai/config.ts
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { AiConfig, AiPreset, AiProviderConfig, WorkerDB } from './types';

const KEY = 's_ai';

export const AI_PRESETS: AiPreset[] = [
  { id: 'deepseek',   name: 'DeepSeek',          baseUrl: 'https://api.deepseek.com/v1',                          models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'qwen',       name: '通义千问',           baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',    models: ['qwen-plus', 'qwen-max'] },
  { id: 'moonshot',   name: 'Kimi',              baseUrl: 'https://api.moonshot.cn/v1',                           models: ['kimi-latest'] },
  { id: 'zhipu',      name: '智谱',               baseUrl: 'https://open.bigmodel.cn/api/paas/v4',                 models: ['glm-4.6', 'glm-4-flash'] },
  { id: 'doubao',     name: '豆包',               baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',             models: [] },
  { id: 'openai',     name: 'OpenAI',            baseUrl: 'https://api.openai.com/v1',                           models: ['gpt-5', 'gpt-5-mini'] },
  { id: 'anthropic',  name: 'Anthropic(兼容端点)', baseUrl: 'https://api.anthropic.com/v1',                        models: ['claude-sonnet-5'] },
  { id: 'gemini',     name: 'Gemini(兼容端点)',    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-pro'] },
  { id: 'custom',     name: '自定义',             baseUrl: '',                                                    models: [] },
];

export const DEFAULT_AI_CONFIG: AiConfig = { providers: [], activeProviderId: null, systemPrompt: '' };

export async function loadAiConfig(db: WorkerDB): Promise<AiConfig> {
  const row = await db.select().from(schema.options).where(eq(schema.options.key, KEY)).get();
  if (!row?.value) return { ...DEFAULT_AI_CONFIG };
  try {
    const p = JSON.parse(row.value);
    return {
      providers: Array.isArray(p?.providers) ? p.providers : [],
      activeProviderId: typeof p?.activeProviderId === 'string' ? p.activeProviderId : null,
      systemPrompt: typeof p?.systemPrompt === 'string' ? p.systemPrompt : '',
    };
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

export async function saveAiConfig(db: WorkerDB, cfg: AiConfig): Promise<void> {
  const value = JSON.stringify(cfg);
  await db.insert(schema.options).values({ key: KEY, value })
    .onConflictDoUpdate({ target: schema.options.key, set: { value } });
}

/** apiKey → `sk-***` + 尾4位(不足4位全打码) */
function maskKey(k: string): string {
  const tail = k.length >= 8 ? k.slice(-4) : '';
  return `sk-***${tail}`;
}

export function maskConfig(cfg: AiConfig): AiConfig {
  return { ...cfg, providers: cfg.providers.map(p => ({ ...p, apiKey: maskKey(p.apiKey) })) };
}

/** 入参 apiKey 是打码占位(含 ***)则沿用 existing 同 id 的原 key */
export function mergeMaskedKeys(existing: AiConfig, incoming: AiConfig): AiConfig {
  const byId = new Map(existing.providers.map(p => [p.id, p]));
  return {
    ...incoming,
    providers: incoming.providers.map(p =>
      p.apiKey.includes('***') && byId.get(p.id)?.apiKey
        ? { ...p, apiKey: byId.get(p.id)!.apiKey }
        : p,
    ),
  };
}

/** 激活厂商必须存在且 enabled,否则 null(调用方给出"请到模型配置"引导) */
export function resolveActiveProvider(cfg: AiConfig): AiProviderConfig | null {
  const p = cfg.providers.find(x => x.id === cfg.activeProviderId);
  return p && p.enabled ? p : null;
}
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/config.test.ts`
Expected: PASS(6 个用例)

- [x] **Step 5: 提交**

```bash
git add workers/src/ai/ workers/tests/ai/
git commit -m "feat(ai): s_ai 配置存取/预设厂商表/apiKey 打码与合并"
```

### Task 2: 配置端点(handler + Zod + 路由注册)

**Files:**
- Modify: `workers/src/lib/validate.ts`(文件末尾追加)
- Create: `workers/src/handlers/ai.ts`
- Modify: `workers/src/router.ts`(「主题配置 API」分区之后、「伺服路由」之前插入)
- Test: `workers/tests/ai/endpoints.test.ts`

- [x] **Step 1: 写失败测试**

```ts
// workers/tests/ai/endpoints.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createApp } from '../../src/router';
import { resetTables, seedUser, validCookie } from '../helpers';

beforeEach(async () => { await resetTables(); await seedUser(); });

const UA = 'test-agent';
function authed(path: string, init?: RequestInit) {
  return createApp().request(new Request(`http://x${path}`, {
    ...init,
    headers: { ...init?.headers, cookie: `key=${validCookie(UA)}`, 'user-agent': UA },
  }), undefined, env as any);
}

describe('GET/POST /api/ai_config', () => {
  it('未登录 401', async () => {
    const res = await createApp().request(new Request('http://x/api/ai_config'), undefined, env as any);
    expect(res.status).toBe(401);
  });

  it('读取默认配置 + 预设表下发', async () => {
    const res = await authed('/api/ai_config');
    const json = await res.json();
    expect(json.code).toBe(0);
    expect(json.data.config.providers).toEqual([]);
    expect(json.data.presets.length).toBeGreaterThan(5);
  });

  it('保存(JSON body)→ 读回 apiKey 打码 → 占位保存不覆盖原值', async () => {
    const payload = {
      providers: [{ id: 'p1', name: 'DeepSeek', preset: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-secret-1234',
        model: 'deepseek-chat', enabled: true }],
      activeProviderId: 'p1', systemPrompt: '',
    };
    const save = await authed('/api/ai_config', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    expect((await save.json()).code).toBe(0);

    const got = await (await authed('/api/ai_config')).json();
    expect(got.data.config.providers[0].apiKey).toBe('sk-***1234');

    // 回显打码值再保存:key 不变,model 变
    const maskedPayload = JSON.parse(JSON.stringify(payload));
    maskedPayload.providers[0].apiKey = 'sk-***1234';
    maskedPayload.providers[0].model = 'deepseek-reasoner';
    await authed('/api/ai_config', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(maskedPayload),
    });
    const got2 = await (await authed('/api/ai_config')).json();
    expect(got2.data.config.providers[0].model).toBe('deepseek-reasoner');
    // 原值未丢:直接读库验证
    const row = await env.DB.prepare("SELECT value FROM on_options WHERE key='s_ai'").first<any>();
    expect(row.value).toContain('sk-secret-1234');
  });

  it('非法 JSON body 报业务错误', async () => {
    const res = await authed('/api/ai_config', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops',
    });
    expect((await res.json()).code).not.toBe(0);
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/endpoints.test.ts`
Expected: FAIL(路由不存在,404)

- [x] **Step 3: 实现**

`workers/src/lib/validate.ts` 末尾追加:

```ts
// ---------- AI ----------

export const aiProviderSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  preset: z.string().min(1).max(32),
  baseUrl: z.url().max(256),
  apiKey: z.string().max(256),   // 允许回显的打码占位(含 ***),保存时合并回原值
  model: z.string().min(1).max(128),
  enabled: z.boolean(),
});

export const aiConfigSchema = z.object({
  token: z.string().optional(),
  providers: z.array(aiProviderSchema).max(10),
  activeProviderId: z.string().max(64).nullable(),
  systemPrompt: z.string().max(4000).optional().default(''),
});
```

```ts
// workers/src/handlers/ai.ts
// AI 域 handler 层:纯函数惯例,流式胶水不在此文件(见 router.ts ai_chat)。
import {
  loadAiConfig, saveAiConfig, maskConfig, mergeMaskedKeys, AI_PRESETS,
} from '../ai/config';

export async function getAiConfigHandler(db: WorkerDB) {
  const config = await loadAiConfig(db);
  return { code: 0, data: { config: maskConfig(config), presets: AI_PRESETS } };
}

export async function saveAiConfigHandler(db: WorkerDB, incoming: unknown) {
  const existing = await loadAiConfig(db);
  const merged = mergeMaskedKeys(existing, incoming as never);
  await saveAiConfig(db, merged);
  return { code: 0, data: { config: maskConfig(merged) } };
}
```

注意:`saveAiConfigHandler` 收到的 `incoming` 已在 router 层经 `aiConfigSchema.parse`(Zod 校验后的可信输入),handler 内不再重复校验——与本仓"router parseBody+Zod,handler 纯业务"的分工一致。

`workers/src/router.ts` 修改三处:

1) import 区追加:

```ts
import { streamSSE } from 'hono/streaming';
import { getAiConfigHandler, saveAiConfigHandler } from './handlers/ai';
import { aiConfigSchema } from './lib/validate';
```

2) 「主题配置 API」分区之后、「伺服路由」之前插入:

```ts
  // ---------- AI 助手(仅管理员) ----------

  app.get('/api/ai_config', authMiddleware, async c => {
    return c.json(await getAiConfigHandler(c.get('db')));
  });

  app.post('/api/ai_config', authMiddleware, async c => {
    // JSON body(先例:import_json)——providers 数组/布尔值走 FormData 会失真
    const payload = await c.req.json().catch(() => {
      throw new Error('请求体必须是 JSON');
    });
    const parsed = aiConfigSchema.parse(payload);
    return c.json(await saveAiConfigHandler(c.get('db'), parsed));
  });
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/endpoints.test.ts`
Expected: PASS(4 个用例)

- [x] **Step 5: 提交**

```bash
git add workers/src/lib/validate.ts workers/src/handlers/ai.ts workers/src/router.ts workers/tests/ai/endpoints.test.ts
git commit -m "feat(ai): GET/POST /api/ai_config 配置端点(key 打码回显/占位不覆盖)"
```

### Task 3: web 模型配置页

**Files:**
- Modify: `web/src/api/client.ts`(api 对象追加方法)
- Create: `web/src/routes/Admin/AiConfig.tsx`
- Modify: `web/src/App.tsx`(注册路由)
- Modify: `web/src/routes/Admin/Layout.tsx`(NAV_SECTIONS 加分组)

- [x] **Step 1: client.ts 追加方法**(api 对象内,tokenInfo 之前)

```ts
  // AI 助手
  aiConfig: () => get('/api/ai_config'),
  saveAiConfig: (payload: unknown) => postJson('/api/ai_config', payload),
```

- [x] **Step 2: AiConfig 页面**

```tsx
// web/src/routes/Admin/AiConfig.tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Save, Bot } from 'lucide-react';
import { api } from '@/api/client';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';

interface Provider {
  id: string; name: string; preset: string;
  baseUrl: string; apiKey: string; model: string; enabled: boolean;
}
interface Preset { id: string; name: string; baseUrl: string; models: string[] }

export function AdminAiConfig() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.aiConfig().then((res: any) => {
      setProviders(res.data.config.providers);
      setPresets(res.data.presets);
      setActiveId(res.data.config.activeProviderId);
      setSystemPrompt(res.data.config.systemPrompt ?? '');
    }).finally(() => setLoading(false));
  }, []);

  const patch = (id: string, p: Partial<Provider>) =>
    setProviders(prev => prev.map(x => (x.id === id ? { ...x, ...p } : x)));

  const applyPreset = (id: string, presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    patch(id, {
      preset: presetId,
      name: preset.name === '自定义' ? '自定义厂商' : preset.name,
      baseUrl: preset.baseUrl,
      model: preset.models[0] ?? '',
    });
  };

  const addProvider = () => {
    const id = crypto.randomUUID();
    setProviders(prev => [...prev, {
      id, name: '', preset: 'custom', baseUrl: '', apiKey: '', model: '', enabled: true,
    }]);
  };

  const save = async () => {
    try {
      await api.saveAiConfig({ providers, activeProviderId: activeId, systemPrompt });
      toast.success('已保存');
      const res: any = await api.aiConfig();
      setProviders(res.data.config.providers);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  if (loading) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="模型配置" desc="对接 OpenAI 兼容厂商,Key 仅管理员可见(回显打码,留打码值不变即不修改)" />

      {providers.map(p => (
        <Card key={p.id} className={!p.enabled ? 'opacity-60' : ''}>
          <CardContent className="grid gap-4 p-5">
            <div className="flex items-center gap-3">
              <Select value={p.preset} onValueChange={v => applyPreset(p.id, v)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {presets.map(ps => (
                    <SelectItem key={ps.id} value={ps.id}>{ps.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input className="flex-1" placeholder="显示名称" value={p.name}
                onChange={e => patch(p.id, { name: e.target.value })} />
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={p.enabled} onCheckedChange={v => patch(p.id, { enabled: v })} />启用
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="active-provider" checked={activeId === p.id}
                  onChange={() => setActiveId(p.id)} />当前
              </label>
              <Button variant="ghost" size="icon" onClick={() =>
                setProviders(prev => prev.filter(x => x.id !== p.id))}>
                <Trash2 size={16} className="text-destructive" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Base URL</Label>
                <Input value={p.baseUrl} placeholder="https://api.deepseek.com/v1"
                  onChange={e => patch(p.id, { baseUrl: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>模型名</Label>
                <Input value={p.model} placeholder="deepseek-chat" list={`models-${p.id}`}
                  onChange={e => patch(p.id, { model: e.target.value })} />
                <datalist id={`models-${p.id}`}>
                  {(presets.find(ps => ps.id === p.preset)?.models ?? []).map(m =>
                    <option key={m} value={m} />)}
                </datalist>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input type="password" value={p.apiKey} placeholder="sk-..."
                onChange={e => patch(p.id, { apiKey: e.target.value })} />
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex gap-3">
        <Button variant="outline" onClick={addProvider}><Plus size={16} />新增厂商</Button>
        <Button onClick={save} disabled={!providers.some(p => p.enabled)}>
          <Save size={16} />保存配置
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-2 p-5">
          <Label className="flex items-center gap-2"><Bot size={16} />系统提示词(可选,留空用默认)</Label>
          <textarea
            className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
            placeholder="例如:你是我的书签导航站助手,回答保持简洁。"
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [x] **Step 3: 注册路由与菜单**

`web/src/App.tsx`:import 区加 `import { AdminAiConfig } from './routes/Admin/AiConfig';`,`settings` Route 之后加:

```tsx
            <Route path="ai-config" element={<AdminAiConfig />} />
```

`web/src/routes/Admin/Layout.tsx`:NAV_SECTIONS 的「系统配置」分组之后加一个分组(import 区补 `Sparkles, Settings2` 已有则只加 `Sparkles`):

```ts
  {
    label: 'AI 助手',
    items: [
      { to: '/admin/assistant', label: 'AI 助手', icon: Sparkles },
      { to: '/admin/ai-config', label: '模型配置', icon: Bot },
    ],
  },
```

(lucide import 行补 `Sparkles, Bot`。`/admin/assistant` 路由在 Task 11 注册,本任务先挂菜单;若介意临时死链,可把 Assistant 条目与路由都推迟到 Task 11 一并加——二选一,推荐后者。)

- [x] **Step 4: 构建验证**

Run: `pnpm --filter web build`
Expected: tsc + vite build 成功

- [x] **Step 5: 手动验证**(wrangler dev 起本地环境)

Run: `pnpm --filter @navbook/workers dev`(另开终端 `pnpm --filter web dev` 代理到本地,按 web/vite.config 现有代理配置)
验证:登录 → 模型配置页 → 选 DeepSeek 预设自动填充 → 填 key 保存 → 刷新页面回显 `sk-***1234` → 原样再保存 → 不弹"key 错误"(原值未丢)。

- [x] **Step 6: 提交**

```bash
git add web/src
git commit -m "feat(web): 模型配置页(预设厂商/启停/当前标记/系统提示词)"
```

---

## Phase 2 聊天核心(只读工具)

### Task 4: 会话/消息表 + conversations.ts

**Files:**
- Create: `workers/src/db/migrations/0001_ai_conversations.sql`
- Modify: `workers/src/db/schema.ts`(文件末尾追加,头部注释强调的同 commit 约束不变)
- Create: `workers/src/ai/conversations.ts`
- Test: `workers/tests/ai/conversations.test.ts`

- [x] **Step 1: 写失败测试**

```ts
// workers/tests/ai/conversations.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { resetTables } from '../helpers';
import {
  createConversation, listConversations, deleteConversation,
  insertMessage, listMessages, updateMessageContent, countMessages,
} from '../../src/ai/conversations';

beforeEach(async () => { await resetTables(); });
const db = () => getDb(env.DB);

describe('conversations', () => {
  it('创建后列表按 updated_at 倒序', async () => {
    const a = await createConversation(db(), '会话A');
    const b = await createConversation(db(), '会话B');
    const list = await listConversations(db());
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
    expect(list[0].title).toBe('会话B');
  });

  it('首条消息自动落标题 + touch 更新 updated_at', async () => {
    const c = await createConversation(db(), '');
    await insertMessage(db(), c.id, 'user', { text: '帮我找一个 GitHub 仓库,要能管理书签的那种' });
    const list = await listConversations(db());
    expect(list[0].title).toBe('帮我找一个 GitHub 仓库,要能管理书');
    expect(list[0].updatedAt).toBeGreaterThan(0);
  });

  it('消息按插入序可读回,内容 JSON 已解析', async () => {
    const c = await createConversation(db(), 't');
    const u = await insertMessage(db(), c.id, 'user', { text: 'hi' });
    const a = await insertMessage(db(), c.id, 'assistant',
      { text: 'hello', reasoning: 'think', toolCalls: [{ id: 'c1', name: 'search_links', args: { keyword: 'x' } }] });
    const msgs = await listMessages(db(), c.id);
    expect(msgs.map(m => m.id)).toEqual([u.id, a.id]);
    expect(msgs[0].content).toEqual({ text: 'hi' });
    expect(msgs[1].content).toEqual({
      text: 'hello', reasoning: 'think',
      toolCalls: [{ id: 'c1', name: 'search_links', args: { keyword: 'x' } }],
    });
  });

  it('updateMessageContent 覆盖 content(pending→ok)', async () => {
    const c = await createConversation(db(), 't');
    const m = await insertMessage(db(), c.id, 'tool',
      { toolCallId: 'c1', name: 'delete_link', args: { id: 1 }, status: 'pending', summary: '删除链接#1', result: null });
    await updateMessageContent(db(), m.id,
      { toolCallId: 'c1', name: 'delete_link', args: { id: 1 }, status: 'ok', summary: '已删除链接#1', result: { code: 0 } });
    const msgs = await listMessages(db(), c.id);
    expect((msgs[0].content as any).status).toBe('ok');
  });

  it('删除会话级联删消息', async () => {
    const c = await createConversation(db(), 't');
    await insertMessage(db(), c.id, 'user', { text: 'hi' });
    await deleteConversation(db(), c.id);
    expect(await listConversations(db())).toEqual([]);
    expect(await countMessages(db(), c.id)).toBe(0);
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/conversations.test.ts`
Expected: FAIL(模块/表不存在)

- [x] **Step 3: 迁移 SQL + schema + 实现**

```sql
-- workers/src/db/migrations/0001_ai_conversations.sql
-- 注意:本文件与 src/db/schema.ts 必须同 commit 修改;SQL 是 D1 结构的唯一事实源。
CREATE TABLE on_ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX on_ai_conversations_updated_at_idx ON on_ai_conversations(updated_at);

CREATE TABLE on_ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,          -- 'user' | 'assistant' | 'tool'
  content TEXT NOT NULL,       -- JSON,形状见 ai/types.ts ChatMsgContent
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX on_ai_messages_conversation_id_idx ON on_ai_messages(conversation_id);
```

`workers/src/db/schema.ts` 末尾追加:

```ts
export const aiConversations = sqliteTable('on_ai_conversations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [
  index('on_ai_conversations_updated_at_idx').on(t.updatedAt),
]);

export const aiMessages = sqliteTable('on_ai_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: integer('conversation_id').notNull(),
  // 'user' | 'assistant' | 'tool';content 为 JSON 字符串(形状见 ai/types.ts)
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [
  index('on_ai_messages_conversation_id_idx').on(t.conversationId),
]);
```

```ts
// workers/src/ai/conversations.ts
// 会话/消息 CRUD。只依赖 db;不知道 agent/provider 的存在(单向依赖)。
import { eq, desc, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { ChatMsgContent, WorkerDB } from './types';

const now = () => Math.floor(Date.now() / 1000);

export interface ConversationRow {
  id: number; title: string; createdAt: number; updatedAt: number;
}
export interface ChatMessageDto {
  id: number; role: 'user' | 'assistant' | 'tool'; content: ChatMsgContent; createdAt: number;
}

export async function createConversation(db: WorkerDB, title: string): Promise<ConversationRow> {
  const t = now();
  const row = await db.insert(schema.aiConversations)
    .values({ title, createdAt: t, updatedAt: t })
    .returning().get();
  return row;
}

export async function listConversations(db: WorkerDB): Promise<ConversationRow[]> {
  return db.select().from(schema.aiConversations)
    .orderBy(desc(schema.aiConversations.updatedAt), desc(schema.aiConversations.id)).all();
}

export async function deleteConversation(db: WorkerDB, id: number): Promise<void> {
  await db.delete(schema.aiConversations).where(eq(schema.aiConversations.id, id));
  await db.delete(schema.aiMessages).where(eq(schema.aiMessages.conversationId, id));
}

/** 首条消息且标题为空时,自动以消息前 20 字作标题(spec:不额外调模型) */
async function maybeSetTitle(db: WorkerDB, conversationId: number, firstText: string) {
  const conv = await db.select().from(schema.aiConversations)
    .where(eq(schema.aiConversations.id, conversationId)).get();
  if (conv && !conv.title) {
    await db.update(schema.aiConversations)
      .set({ title: firstText.slice(0, 20) })
      .where(eq(schema.aiConversations.id, conversationId));
  }
}

export async function insertMessage(
  db: WorkerDB, conversationId: number,
  role: 'user' | 'assistant' | 'tool', content: ChatMsgContent,
): Promise<{ id: number }> {
  const row = await db.insert(schema.aiMessages)
    .values({ conversationId, role, content: JSON.stringify(content), createdAt: now() })
    .returning({ id: schema.aiMessages.id }).get();
  await db.update(schema.aiConversations)
    .set({ updatedAt: now() })
    .where(eq(schema.aiConversations.id, conversationId));
  if (role === 'user' && 'text' in content) await maybeSetTitle(db, conversationId, content.text);
  return row;
}

export async function updateMessageContent(db: WorkerDB, id: number, content: ChatMsgContent): Promise<void> {
  await db.update(schema.aiMessages)
    .set({ content: JSON.stringify(content) })
    .where(eq(schema.aiMessages.id, id));
}

export async function listMessages(db: WorkerDB, conversationId: number): Promise<ChatMessageDto[]> {
  const rows = await db.select().from(schema.aiMessages)
    .where(eq(schema.aiMessages.conversationId, conversationId))
    .orderBy(schema.aiMessages.id).all();
  return rows.map(r => ({
    id: r.id,
    role: r.role as ChatMessageDto['role'],
    content: JSON.parse(r.content) as ChatMsgContent,
    createdAt: r.createdAt,
  }));
}

export async function countMessages(db: WorkerDB, conversationId: number): Promise<number> {
  const row = await db.select({ c: sql<number>`count(*)` }).from(schema.aiMessages)
    .where(eq(schema.aiMessages.conversationId, conversationId)).get();
  return row?.c ?? 0;
}
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/conversations.test.ts`
Expected: PASS(5 个用例)

- [x] **Step 5: 提交**

```bash
git add workers/src/db workers/src/ai/conversations.ts workers/tests/ai/conversations.test.ts
git commit -m "feat(ai): on_ai_conversations/on_ai_messages 表与会话 CRUD(标题自动生成/级联删除)"
```

### Task 5: shared 聊天契约类型 + SSE 解析器

**Files:**
- Create: `shared/src/chat/types.ts`
- Create: `shared/src/chat/sse.ts`
- Create: `shared/src/chat/sse.test.ts`
- Modify: `shared/package.json`(test 脚本 + vitest devDep)
- Modify: `shared/src/index.ts`(re-export)

- [x] **Step 1: shared/package.json 加测试设施**

```json
{
  "name": "@navbook/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^4.1.11" }
}
```

Run: `pnpm install`(链接新 devDep)

- [x] **Step 2: 写失败测试**

```ts
// shared/src/chat/sse.test.ts
import { describe, it, expect } from 'vitest';
import { parseSseStream } from './sse';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(enc.encode(chunks[i++]));
      else ctrl.close();
    },
  });
}

describe('parseSseStream', () => {
  it('解析 event/data 对,容忍心跳注释行', async () => {
    const out = [];
    for await (const ev of parseSseStream(streamOf([
      ': hb\n\n',
      'event: delta\n',
      'data: {"text":"你好"}\n\n',
      'event: done\ndata: {"messageIds":[]}\n\n',
    ]))) out.push(ev);
    expect(out).toEqual([
      { event: 'delta', data: '{"text":"你好"}' },
      { event: 'done', data: '{"messageIds":[]}' },
    ]);
  });

  it('跨 chunk 边界的事件不丢', async () => {
    const out = [];
    for await (const ev of parseSseStream(streamOf([
      'event: delta\nda', 'ta: {"text":"A"}', '\n\nevent: delta\ndata: {"text":"B"}\n\n',
    ]))) out.push(ev);
    expect(out.map(e => e.event)).toEqual(['delta', 'delta']);
    expect(JSON.parse(out[1].data).text).toBe('B');
  });

  it('多行 data 拼接', async () => {
    const out = [];
    for await (const ev of parseSseStream(streamOf(['event: x\ndata: l1\ndata: l2\n\n']))) out.push(ev);
    expect(out[0].data).toBe('l1\nl2');
  });
});
```

- [x] **Step 3: 跑测试确认失败**

Run: `pnpm --filter @navbook/shared exec vitest run src/chat/sse.test.ts`
Expected: FAIL(模块不存在)

- [x] **Step 4: 实现**

```ts
// shared/src/chat/types.ts
// 线缆契约(与 workers/src/ai/types.ts 镜像,改一处必改另一处):
// - ChatSseEvent = POST /api/ai_chat 的 SSE 事件
// - ChatMsgContent = on_ai_messages.content 的 JSON 形状
export type ChatSseEvent =
  | { type: 'conversation'; cid: number; title: string }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown; danger: 'read' | 'write' }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string; data: unknown }
  | { type: 'confirm_required'; messageId: number; id: string; name: string; args: unknown; summary: string }
  | { type: 'done'; messageIds: number[] }
  | { type: 'error'; code: number; msg: string };

export interface UserMsgContent { text: string }
export interface AssistantMsgContent {
  text: string;
  reasoning: string;
  toolCalls: Array<{ id: string; name: string; args: unknown }>;
}
export type ToolStatus = 'ok' | 'error' | 'pending' | 'rejected';
export interface ToolMsgContent {
  toolCallId: string;
  name: string;
  args: unknown;
  status: ToolStatus;
  summary: string;
  result: unknown;
}
export type ChatMsgContent = UserMsgContent | AssistantMsgContent | ToolMsgContent;

export interface ChatMessageDto {
  id: number;
  role: 'user' | 'assistant' | 'tool';
  content: ChatMsgContent;
  created_at: number;
}

export interface ConversationDto {
  id: number;
  title: string;
  updated_at: number;
}

export interface ChatStreamBody {
  cid: number;
  message?: string;
  confirm?: { message_id: number; action: 'approve' | 'reject' };
}
```

```ts
// shared/src/chat/sse.ts
// fetch POST + ReadableStream 的 SSE 行解析(浏览器 EventSource 不支持 POST)。
// 逐行按 SSE 规范解析:注释行(:开头)忽略、event:/data: 前缀、空行分隔事件。
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const rawEvent = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length) yield { event, data: dataLines.join('\n') };
    }
  }
}
```

`shared/src/index.ts` 末尾追加:

```ts
// ---- AI 聊天(纯 TS,web 与 themes 共用;不依赖任何 UI 框架) ----
export * from './chat/types';
export { parseSseStream } from './chat/sse';
export { ChatMachine } from './chat/machine';   // Task 10 提供;本任务先注释掉此行,Task 10 打开
```

(本任务先不 export machine——写成 `// export { ChatMachine } from './chat/machine';` 注释,Task 10 解开。)

- [x] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @navbook/shared exec vitest run src/chat/sse.test.ts`
Expected: PASS(3 个用例)

- [x] **Step 6: 提交**

```bash
git add shared
git commit -m "feat(shared): 聊天线缆契约类型 + SSE 流解析器(跨chunk/心跳/多行data)"
```

### Task 6: workers `ai/provider.ts` — OpenAI 兼容流式客户端

**Files:**
- Create: `workers/src/ai/provider.ts`
- Test: `workers/tests/ai/provider.test.ts`

- [x] **Step 1: 写失败测试**(fixture 覆盖:纯文本/思考流/tool_calls 分片拼装/HTTP 错误)

```ts
// workers/tests/ai/provider.test.ts
import { describe, it, expect } from 'vitest';
import { OpenAiCompatProvider, ProviderError } from '../../src/ai/provider';
import type { ProviderStreamEvent } from '../../src/ai/types';

const enc = new TextEncoder();
function sseResponse(lines: string[], status = 200): Response {
  const body = lines.join('\n') + '\n';
  return new Response(enc.encode(body), {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}
async function collect(gen: AsyncGenerator<ProviderStreamEvent>) {
  const out: ProviderStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}
const ARGS = { baseUrl: 'https://fake/v1', apiKey: 'sk-x', model: 'm', messages: [{ role: 'user', content: 'hi' }] };

describe('OpenAiCompatProvider', () => {
  it('纯文本流 + finish', async () => {
    const p = new OpenAiCompatProvider(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":"好"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ]));
    const out = await collect(p.streamChat(ARGS));
    expect(out).toEqual([
      { type: 'text', delta: '你' },
      { type: 'text', delta: '好' },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('reasoning_content 走 reasoning 事件(DeepSeek/Qwen 思考模型)', async () => {
    const p = new OpenAiCompatProvider(async () => sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"思考中"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":"答案"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ]));
    const out = await collect(p.streamChat(ARGS));
    expect(out[0]).toEqual({ type: 'reasoning', delta: '思考中' });
    expect(out[1]).toEqual({ type: 'text', delta: '答案' });
  });

  it('tool_calls 分片到达:id/name 首片、arguments 逐片拼接,流末输出拼装完整调用', async () => {
    const p = new OpenAiCompatProvider(async () => sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search_links","arguments":""}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"key"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"word\\":\\"gi\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ]));
    const out = await collect(p.streamChat(ARGS));
    expect(out).toEqual([
      { type: 'tool_call', call: { id: 'call_1', name: 'search_links', args: '{"keyword":"gi"}' } },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });

  it('HTTP 401 → ProviderError 带可读文案', async () => {
    const p = new OpenAiCompatProvider(async () => new Response('{"error":"bad key"}', { status: 401 }));
    await expect(collect(p.streamChat(ARGS))).rejects.toSatisfy((e: unknown) =>
      e instanceof ProviderError && e.status === 401 && (e as ProviderError).message.includes('API Key'));
  });

  it('请求体含 tools 与 stream:true,鉴权头 Bearer', async () => {
    let captured!: Request;
    const p = new OpenAiCompatProvider(async (req: RequestInfo, init?: RequestInit) => {
      captured = new Request(req, init);
      return sseResponse(['data: [DONE]']);
    });
    await collect(p.streamChat({ ...ARGS, tools: [{ type: 'function', function: { name: 'x', parameters: {} } }] }));
    expect(captured.url).toBe('https://fake/v1/chat/completions');
    expect(captured.headers.get('authorization')).toBe('Bearer sk-x');
    const body = await captured.json();
    expect(body.stream).toBe(true);
    expect(body.tools).toHaveLength(1);
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/provider.test.ts`
Expected: FAIL(模块不存在)

- [x] **Step 3: 实现**

```ts
// workers/src/ai/provider.ts
// OpenAI 兼容 /chat/completions 流式客户端。只认识协议,不认识业务工具;
// fetch 可注入(测试 fixture)。tool_calls 分片在流末统一拼装输出。
import type { ProviderClient, ProviderMessage, ProviderStreamEvent } from './types';

export class ProviderError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

function classifyHttpError(status: number, body: string): string {
  if (status === 401) return 'API Key 无效,请到「模型配置」检查';
  if (status === 402) return '厂商账户余额不足,请到厂商控制台充值';
  if (status === 403) return '厂商拒绝访问(403),请检查 Key 权限或 IP 白名单';
  if (status === 429) return '请求过于频繁(厂商限流),请稍后再试';
  const detail = body.slice(0, 200).replace(/\s+/g, ' ').trim();
  return `厂商接口错误(HTTP ${status})${detail ? ':' + detail : ''}`;
}

export class OpenAiCompatProvider implements ProviderClient {
  constructor(private fetchFn: typeof fetch = fetch) {}

  async *streamChat(p: {
    baseUrl: string; apiKey: string; model: string;
    messages: ProviderMessage[]; tools?: unknown[]; signal?: AbortSignal;
  }): AsyncGenerator<ProviderStreamEvent> {
    const res = await this.fetchFn(`${p.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({
        model: p.model,
        messages: p.messages,
        tools: p.tools?.length ? p.tools : undefined,
        stream: true,
      }),
      signal: p.signal,
    });
    if (!res.ok || !res.body) {
      const errBody = await res.text().catch(() => '');
      throw new ProviderError(res.status, classifyHttpError(res.status, errBody));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    // OpenAI 兼容流:tool_calls 分片到达(index 定位,id/name 首片给出,arguments 逐片累加)
    const pendingToolCalls: Array<{ id: string; name: string; args: string } | undefined> = [];
    let finishReason = '';

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;   // 注释行/event 行等忽略(厂商单行 data)
        const data = line.slice(5).trim();
        if (data === '[DONE]') break outer;
        let chunk: any;
        try { chunk = JSON.parse(data); } catch { continue; }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (typeof delta.content === 'string' && delta.content) yield { type: 'text', delta: delta.content };
        // 思考流:DeepSeek reasoning_content;部分厂商叫 reasoning
        const rc = delta.reasoning_content ?? delta.reasoning;
        if (typeof rc === 'string' && rc) yield { type: 'reasoning', delta: rc };
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const i = typeof tc.index === 'number' ? tc.index : 0;
            pendingToolCalls[i] ??= { id: '', name: '', args: '' };
            if (tc.id) pendingToolCalls[i]!.id = tc.id;
            if (tc.function?.name) pendingToolCalls[i]!.name = tc.function.name;
            if (tc.function?.arguments) pendingToolCalls[i]!.args += tc.function.arguments;
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    }
    for (const c of pendingToolCalls) {
      if (c && (c.id || c.name)) yield { type: 'tool_call', call: c };
    }
    yield { type: 'finish', reason: finishReason || 'stop' };
  }
}
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/provider.test.ts`
Expected: PASS(5 个用例)

- [x] **Step 5: 提交**

```bash
git add workers/src/ai/provider.ts workers/tests/ai/provider.test.ts
git commit -m "feat(ai): OpenAI 兼容流式客户端(reasoning流/tool_calls分片拼装/错误分类文案)"
```

### Task 7: workers `ai/tools.ts` — 工具注册表(本任务先落 5 个只读工具)

**Files:**
- Create: `workers/src/ai/tools.ts`
- Test: `workers/tests/ai/tools.test.ts`

- [x] **Step 1: 写失败测试**

```ts
// workers/tests/ai/tools.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { resetTables } from '../helpers';
import { addCategoryHandler } from '../../src/handlers/category';
import { addLinkHandler } from '../../src/handlers/link';
import { AI_TOOLS, findTool, toolSpecs } from '../../src/ai/tools';
import { saveAiConfig } from '../../src/ai/config';

beforeEach(async () => { await resetTables(); });
const db = () => getDb(env.DB);

async function seed() {
  const cat = await addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
  await addLinkHandler(db(), { fid: cat.id, title: 'GitHub', url: 'https://github.com', description: '代码托管', weight: 0, property: 0, url_standby: '', font_icon: '' });
  return cat;
}

describe('read tools', () => {
  it('search_links 命中标题关键词', async () => {
    await seed();
    const res: any = await findTool('search_links')!.execute(db(), { keyword: 'git' });
    expect(res.code).toBe(0);
    expect(res.count).toBe(1);
    expect(res.data[0].title).toBe('GitHub');
  });

  it('list_categories 返回全量(管理员视角,含私密)', async () => {
    await addCategoryHandler(db(), { name: '私密', property: 1, weight: 0, description: '', font_icon: '', fid: 0 });
    const res: any = await findTool('list_categories')!.execute(db(), {});
    expect(res.data).toHaveLength(2);
  });

  it('get_link 按 id 取详情,不存在时 code!=0(喂回模型自愈)', async () => {
    await seed();
    const ok: any = await findTool('get_link')!.execute(db(), { id: 1 });
    expect(ok.code === 0 || ok.data).toBeTruthy();
    const miss: any = await findTool('get_link')!.execute(db(), { id: 999 });
    expect(miss.code).not.toBe(0);
  });

  it('get_click_stats 聚合 on_clicks', async () => {
    const cat = await seed();
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare('INSERT INTO on_clicks (link_id, ip, ua, referer, ts) VALUES (?,?,?,?,?)')
        .bind(1, '1.1.1.1', 'ua', '', now - i).run();
    }
    const res: any = await findTool('get_click_stats')!.execute(db(), { days: 30, limit: 10 });
    expect(res.data[0].linkId).toBe(1);
    expect(res.data[0].clicks).toBe(3);
    expect(res.data[0].title).toBe('GitHub');
  });

  it('get_site_config 返回站点设置', async () => {
    await saveAiConfig(db(), { providers: [], activeProviderId: null, systemPrompt: '' });
    const res: any = await findTool('get_site_config')!.execute(db(), {});
    expect(res.site_private).toBe(false);
    expect(res.site_title).toBe('NavBook');
  });

  it('注册表形态:danger 标注 + OpenAI tools 规格 + summarize 中文文案', () => {
    expect(AI_TOOLS.filter(t => t.danger === 'read')).toHaveLength(5);
    const spec = toolSpecs() as any[];
    expect(spec.every(s => s.type === 'function' && s.function.name && s.function.parameters)).toBe(true);
    expect(findTool('search_links')!.summarize({ keyword: 'git' }, null)).toContain('git');
    expect(findTool('nope')).toBeUndefined();
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/tools.test.ts`
Expected: FAIL(模块不存在)

- [x] **Step 3: 实现**

```ts
// workers/src/ai/tools.ts
// 工具注册表:execute 直调 handlers/* 纯函数(权限天然=管理员,业务校验/转义全复用)。
// 不知道 provider/agent 的存在;新增工具=加一个条目。
import { eq, gt, desc, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { WorkerDB } from './types';
import { linkListHandler, getALinkHandler } from '../handlers/link';
import { categoryListHandler, getACategoryHandler } from '../handlers/category';
import { getSiteConfig, siteConfigData } from '../handlers/site';

export interface AiTool {
  name: string;
  description: string;                 // 给模型看的中文说明
  parameters: Record<string, unknown>; // JSON Schema(OpenAI function calling)
  danger: 'read' | 'write';
  /** 确认卡(执行前 result=null)与结果卡(执行后)的中文文案,后端生成前端照渲染 */
  summarize(args: Record<string, any>, result: unknown): string;
  execute(db: WorkerDB, args: Record<string, any>): Promise<unknown>;
}

const s = (args: Record<string, any>, summary: string) => summary;

export const AI_TOOLS: AiTool[] = [
  {
    name: 'search_links',
    description: '按关键词/分类/属性搜索站内链接。关键词模糊匹配标题、URL、描述。返回分页结果(最多20条)。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词,可选' },
        category_id: { type: 'number', description: '限定分类 id,可选' },
        property: { type: 'number', enum: [0, 1], description: '0=公开 1=私密,可选' },
      },
    },
    danger: 'read',
    summarize: (a, r) => r && typeof r === 'object' && 'count' in r
      ? `搜索${a.keyword ? `「${a.keyword}」` : '链接'}:${(r as any).count} 条结果`
      : `搜索链接${a.keyword ? `「${a.keyword}」` : ''}`,
    execute: (db, a) => linkListHandler(db, 1, 20, true, {
      keyword: a.keyword,
      categoryId: a.category_id,
      property: a.property,
    }),
  },
  {
    name: 'list_categories',
    description: '列出全部分类(含私密),含 id/名称/属性/描述/父子关系,可先调它拿 category_id。',
    parameters: { type: 'object', properties: {} },
    danger: 'read',
    summarize: (a, r) => `列出分类 ${(r as any)?.count ?? ''} 条`.trim(),
    execute: (db) => categoryListHandler(db, 1, 100, true),
  },
  {
    name: 'get_link',
    description: '按 id 获取单条链接完整详情。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
    danger: 'read',
    summarize: (a) => `查看链接 #${a.id}`,
    execute: (db, a) => getALinkHandler(db, a.id, true),
  },
  {
    name: 'get_click_stats',
    description: '查询最近 N 天链接点击量排行(on_clicks 聚合),用于"哪个链接最热门"类问题。',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', enum: [7, 30, 90], description: '统计窗口,默认 30' },
        limit: { type: 'number', description: '返回条数,默认 10' },
      },
    },
    danger: 'read',
    summarize: (a) => `最近 ${a.days ?? 30} 天点击排行`,
    execute: async (db, a) => {
      const days = a.days ?? 30;
      const limit = Math.min(50, Math.max(1, a.limit ?? 10));
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      const rows = await db.select({
        linkId: schema.clicks.linkId,
        title: schema.links.title,
        clicks: sql<number>`count(*)`,
      }).from(schema.clicks)
        .innerJoin(schema.links, eq(schema.clicks.linkId, schema.links.id))
        .where(gt(schema.clicks.ts, since))
        .groupBy(schema.clicks.linkId, schema.links.title)
        .orderBy(desc(sql`count(*)`))
        .limit(limit).all();
      return { code: 0, data: rows.map(r => ({ ...r, title: r.title })) };
    },
  },
  {
    name: 'get_site_config',
    description: '读取站点设置(标题/副标题/隐私模式开关),不含任何密钥。',
    parameters: { type: 'object', properties: {} },
    danger: 'read',
    summarize: () => '读取站点设置',
    execute: async (db) => siteConfigData(await getSiteConfig(db)),
  },
];

export function findTool(name: string): AiTool | undefined {
  return AI_TOOLS.find(t => t.name === name);
}

/** OpenAI chat/completions 的 tools 参数 */
export function toolSpecs(): unknown[] {
  return AI_TOOLS.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

// Task 12(写工具)将向本数组追加 create_link/update_link/delete_link/
// create_category/update_category/delete_category;getACategoryHandler 等 import 已备好。
export { getACategoryHandler };
```

(末尾 `export { getACategoryHandler }` 仅为 Task 12 复用而 re-export 的过渡——Task 12 实装写工具时删除该行,直接在写工具内使用。)

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/tools.test.ts`
Expected: PASS(6 个用例)

- [x] **Step 5: 提交**

```bash
git add workers/src/ai/tools.ts workers/tests/ai/tools.test.ts
git commit -m "feat(ai): 工具注册表与5个只读工具(搜索/分类/详情/点击统计/站点设置)"
```

### Task 8: workers `ai/agent.ts` — 循环编排(本任务:纯对话 + 只读工具链)

**Files:**
- Create: `workers/src/ai/agent.ts`
- Test: `workers/tests/ai/agent.test.ts`

- [x] **Step 1: 写失败测试**(FakeProvider 脚本化厂商行为)

```ts
// workers/tests/ai/agent.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { resetTables } from '../helpers';
import { addCategoryHandler } from '../../src/handlers/category';
import { addLinkHandler } from '../../src/handlers/link';
import { runAgentTurn } from '../../src/ai/agent';
import type { ProviderClient, ProviderStreamEvent, ProviderMessage, ChatSseEvent } from '../../src/ai/types';

beforeEach(async () => { await resetTables(); });
const db = () => getDb(env.DB);

/** 脚本化厂商:每次 streamChat 弹出一段事件序列 */
class FakeProvider implements ProviderClient {
  calls: ProviderMessage[][] = [];
  constructor(private turns: ProviderStreamEvent[][]) {}
  async *streamChat(p: { messages: ProviderMessage[] }): AsyncGenerator<ProviderStreamEvent> {
    this.calls.push(p.messages);
    const turn = this.turns.shift() ?? [{ type: 'finish', reason: 'stop' } as ProviderStreamEvent];
    yield* turn;
  }
}

async function collectEvents(provider: FakeProvider, opts: Parameters<typeof runAgentTurn>[2]) {
  const events: ChatSseEvent[] = [];
  const cfg = { providers: [], activeProviderId: null, systemPrompt: '' };
  const conv = opts.conversationId ?? (await (await import('../../src/ai/conversations')).createConversation(db(), 't')).id;
  await runAgentTurn({ db: db(), provider }, cfg, { ...opts, conversationId: conv, emit: async e => { events.push(e); } });
  return events;
}

describe('runAgentTurn(只读阶段)', () => {
  it('纯对话:delta 流出,assistant 消息落库,done 收尾', async () => {
    const provider = new FakeProvider([[{ type: 'text', delta: '你好' }, { type: 'finish', reason: 'stop' }]]);
    const events = await collectEvents(provider, { message: 'hi' });
    expect(events.filter(e => e.type === 'delta').map(e => (e as any).text).join('')).toBe('你好');
    expect(events.at(-1)!.type).toBe('done');
  });

  it('reasoning 事件透传并落库(ReAct 思考流)', async () => {
    const provider = new FakeProvider([[
      { type: 'reasoning', delta: '用户想搜索' },
      { type: 'text', delta: '这是结果' },
      { type: 'finish', reason: 'stop' },
    ]]);
    const events = await collectEvents(provider, { message: '搜个链接' });
    expect(events.some(e => e.type === 'reasoning')).toBe(true);
  });

  it('工具链:模型调 search_links → 读工具直接执行 → 结果喂回下一轮 → 最终回答', async () => {
    const cat = await addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    await addLinkHandler(db(), { fid: cat.id, title: 'GitHub', url: 'https://github.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
    const provider = new FakeProvider([
      [{ type: 'text', delta: '我搜一下' },
       { type: 'tool_call', call: { id: 'c1', name: 'search_links', args: '{"keyword":"git"}' } },
       { type: 'finish', reason: 'tool_calls' }],
      [{ type: 'text', delta: '找到了 GitHub' }, { type: 'finish', reason: 'stop' }],
    ]);
    const events = await collectEvents(provider, { message: '帮我搜 git' });
    const tr = events.find(e => e.type === 'tool_result') as any;
    expect(tr.ok).toBe(true);
    expect(tr.summary).toContain('1 条结果');
    // 第二轮调用里含有 tool 结果消息(role=tool,含原始返回)
    const second = provider.calls[1];
    const toolMsg = second.find(m => m.role === 'tool');
    expect(toolMsg?.tool_call_id).toBe('c1');
    expect(toolMsg?.content).toContain('GitHub');
  });

  it('未知工具名 → 错误结果喂回模型继续,循环不崩', async () => {
    const provider = new FakeProvider([
      [{ type: 'tool_call', call: { id: 'c1', name: 'nope_tool', args: '{}' } }, { type: 'finish', reason: 'tool_calls' }],
      [{ type: 'text', delta: '抱歉' }, { type: 'finish', reason: 'stop' }],
    ]);
    const events = await collectEvents(provider, { message: 'hi' });
    const tr = events.find(e => e.type === 'tool_result') as any;
    expect(tr.ok).toBe(false);
  });

  it('循环上限 8 步熔断:error 事件', async () => {
    // 每轮都要求调工具,永不收敛
    const loops = Array.from({ length: 20 }, () => [
      { type: 'tool_call', call: { id: 'c', name: 'list_categories', args: '{}' } },
      { type: 'finish', reason: 'tool_calls' },
    ] as ProviderStreamEvent[]);
    const provider = new FakeProvider(loops);
    const events = await collectEvents(provider, { message: 'hi' });
    expect(events.some(e => e.type === 'error' && e.msg.includes('8'))).toBe(true);
  });

  it('未配置厂商 → error 事件引导去配置页', async () => {
    const events = await collectEvents(new FakeProvider([]), { message: 'hi' });
    expect(events.some(e => e.type === 'error' && e.msg.includes('模型配置'))).toBe(true);
  });

  it('会话消息数达 500 → 拒绝新消息', async () => {
    const { createConversation, insertMessage } = await import('../../src/ai/conversations');
    const conv = await createConversation(db(), 't');
    for (let i = 0; i < 500; i++) await insertMessage(db(), conv.id, 'user', { text: 'x' });
    const events = await collectEvents(new FakeProvider([]), { message: 'hi', conversationId: conv.id });
    expect(events.some(e => e.type === 'error')).toBe(true);
  });

  it('上下文裁剪:发给厂商的消息条数 ≤ 50(不含 system)', async () => {
    const { createConversation, insertMessage } = await import('../../src/ai/conversations');
    const conv = await createConversation(db(), 't');
    for (let i = 0; i < 60; i++) await insertMessage(db(), conv.id, 'user', { text: `m${i}` });
    const provider = new FakeProvider([[{ type: 'finish', reason: 'stop' }]]);
    await collectEvents(provider, { message: 'new', conversationId: conv.id });
    const msgs = provider.calls[0];
    expect(msgs[0].role).toBe('system');
    expect(msgs.length).toBeLessThanOrEqual(51);
    expect(msgs.at(-1)!.content).toBe('new'); // 最新的用户消息必然在内
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/agent.test.ts`
Expected: FAIL(模块不存在)

- [x] **Step 3: 实现**

```ts
// workers/src/ai/agent.ts
// ReAct 循环编排:Reason(模型文本/思考流)→ Act(tool_call)→ Observe(tool result 喂回)。
// 通过 emit 回调输出线缆事件,不碰 HTTP/SSE(路由层负责);provider 走接口,测试注入 Fake。
import type {
  AiConfig, ChatSseEvent, ProviderClient, ProviderMessage, ToolMsgContent, WorkerDB,
} from './types';
import { resolveActiveProvider } from './config';
import { findTool, toolSpecs } from './tools';
import {
  createConversation, insertMessage, listMessages, countMessages,
} from './conversations';

export const MAX_STEPS = 8;
export const CONTEXT_MESSAGES = 50;
export const MAX_CONVERSATION_MESSAGES = 500;

export const DEFAULT_SYSTEM_PROMPT = [
  '你是 NavBook 书签导航站的 AI 助手,管理员通过对话让你管理站内数据。',
  '可用能力:搜索/查看链接与分类、点击统计、站点设置,以及新增/修改/删除链接和分类。',
  '原则:涉及数据的问题先用工具查询再回答,不确定时调 list_categories 确认 id;',
  '写操作(新增/修改/删除)会请求用户确认,被拒绝时如实告知,不要重复发起同一被拒操作;',
  '回答用简体中文,简洁直接。',
].join('\n');

export interface AgentDeps {
  db: WorkerDB;
  provider: ProviderClient;
}

export interface AgentTurnOptions {
  conversationId: number;            // 0 = 新建会话
  message?: string;
  /** Task 13 实装(写工具确认);接口先立,读阶段不传 */
  confirm?: { messageId: number; action: 'approve' | 'reject' };
  emit: (ev: ChatSseEvent) => Promise<void>;
  signal?: AbortSignal;
}

export async function runAgentTurn(deps: AgentDeps, cfg: AiConfig, opts: AgentTurnOptions): Promise<void> {
  const { db, provider } = deps;
  const emit = opts.emit;

  const fail = async (msg: string) => { await emit({ type: 'error', code: -2000, msg }); };

  const active = resolveActiveProvider(cfg);
  if (!active) return fail('尚未配置可用的模型厂商,请到后台「AI 助手 → 模型配置」添加');

  // 新会话:先建库再发 conversation 事件(前端靠它拿到 cid)
  let cid = opts.conversationId;
  if (!cid) {
    const conv = await createConversation(db, '');
    cid = conv.id;
    await emit({ type: 'conversation', cid, title: '' });
  }

  if (opts.message !== undefined) {
    if (await countMessages(db, cid) >= MAX_CONVERSATION_MESSAGES) {
      return fail(`会话消息数已达上限(${MAX_CONVERSATION_MESSAGES}),请新建会话`);
    }
    await insertMessage(db, cid, 'user', { text: opts.message });
  }

  const messageIds: number[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    if (opts.signal?.aborted) return;
    // ---- 组装上下文(最近 50 条映射为 OpenAI 消息) ----
    const history = (await listMessages(db, cid)).slice(-CONTEXT_MESSAGES);
    const messages: ProviderMessage[] = [
      { role: 'system', content: cfg.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT },
      ...history.map(m => toProviderMessage(m.id, m.role, m.content)),
    ];

    // ---- 流式调用厂商,转发 delta/reasoning ----
    let text = '';
    let reasoning = '';
    const toolCalls: Array<{ id: string; name: string; args: unknown }> = [];
    try {
      for await (const ev of provider.streamChat({
        baseUrl: active.baseUrl, apiKey: active.apiKey, model: active.model,
        messages, tools: toolSpecs(), signal: opts.signal,
      })) {
        if (ev.type === 'text') { text += ev.delta; await emit({ type: 'delta', text: ev.delta }); }
        else if (ev.type === 'reasoning') { reasoning += ev.delta; await emit({ type: 'reasoning', text: ev.delta }); }
        else if (ev.type === 'tool_call') {
          let args: unknown = {};
          try { args = JSON.parse(ev.call.args || '{}'); } catch { args = { _raw: ev.call.args }; }
          toolCalls.push({ id: ev.call.id || `call_${step}_${toolCalls.length}`, name: ev.call.name, args });
        }
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : '厂商请求失败');
    }

    // ---- assistant 消息落库(ReAct:中间推理也是消息,历史即思考链) ----
    const assistantMsg = await insertMessage(db, cid, 'assistant', { text, reasoning, toolCalls });
    messageIds.push(assistantMsg.id);

    if (toolCalls.length === 0) {
      await emit({ type: 'done', messageIds });
      return;
    }

    // ---- 执行工具:读直接执行;写留待 Task 13(本阶段注册表里没有写工具) ----
    let needConfirm = false;
    for (const call of toolCalls) {
      const tool = findTool(call.name);
      const danger = tool?.danger ?? 'read';
      await emit({ type: 'tool_call', id: call.id, name: call.name, args: call.args, danger });

      if (!tool) {
        await persistToolResult(db, cid, emit, messageIds, {
          toolCallId: call.id, name: call.name, args: call.args,
          status: 'error', summary: `未知工具:${call.name}`, result: { code: -2000, msg: '未知工具' },
        });
        continue;
      }
      if (tool.danger === 'write') {
        // 写工具:Task 13 接 confirm_required 流程;当前阶段不可达(注册表无写工具),
        // 但保留分支防止 Task 12 先行合入时静默执行。
        needConfirm = true;
        await persistToolResult(db, cid, emit, messageIds, {
          toolCallId: call.id, name: call.name, args: call.args,
          status: 'pending', summary: tool.summarize(call.args, null), result: null,
        }, true);
        continue;
      }
      const { content } = await execTool(db, tool, call);
      await persistToolResult(db, cid, emit, messageIds, content, false);
    }
    if (needConfirm) {   // 有一张确认卡即终止本轮(前端确认后恢复)
      await emit({ type: 'done', messageIds });
      return;
    }
    // 全是读工具 → 结果已在库,进入下一轮(Observe)
  }
  await fail(`已达最大工具调用步数(${MAX_STEPS}),请简化请求或拆分操作`);
}

// ---- 内部:工具执行(读)——异常/业务错误都转成"错误 tool 结果",喂回模型自愈 ----
async function execTool(db: WorkerDB, tool: { name: string; danger: 'read' | 'write'; summarize: (a: Record<string, any>, r: unknown) => string; execute: (db: WorkerDB, a: Record<string, any>) => Promise<unknown> }, call: { id: string; name: string; args: unknown }) {
  const args = (call.args ?? {}) as Record<string, any>;
  try {
    const result = await tool.execute(db, args);
    const ok = !(result && typeof result === 'object' && 'code' in result && (result as any).code !== 0);
    const content: ToolMsgContent = {
      toolCallId: call.id, name: call.name, args,
      status: ok ? 'ok' : 'error',
      summary: tool.summarize(args, result),
      result,
    };
    return { content, ok };
  } catch (e) {
    return {
      content: {
        toolCallId: call.id, name: call.name, args,
        status: 'error' as const,
        summary: `${tool.summarize(args, null)} 失败:${e instanceof Error ? e.message : '未知错误'}`,
        result: { code: -2000, msg: e instanceof Error ? e.message : '执行异常' },
      },
      ok: false,
    };
  }
}

async function persistToolResult(
  db: WorkerDB, cid: number,
  emit: (ev: ChatSseEvent) => Promise<void>,
  messageIds: number[],
  content: ToolMsgContent,
  pending = false,
) {
  const msg = await insertMessage(db, cid, 'tool', content);
  messageIds.push(msg.id);
  if (pending) {
    await emit({
      type: 'confirm_required', messageId: msg.id,
      id: content.toolCallId, name: content.name, args: content.args, summary: content.summary,
    });
  } else {
    await emit({
      type: 'tool_result', id: content.toolCallId, name: content.name,
      ok: content.status === 'ok', summary: content.summary, data: content.result,
    });
  }
}

// ---- 历史消息 → OpenAI wire 消息 ----
function toProviderMessage(id: number, role: 'user' | 'assistant' | 'tool', content: unknown): ProviderMessage {
  const c = content as any;
  if (role === 'user') return { role: 'user', content: String(c?.text ?? '') };
  if (role === 'assistant') {
    const calls = Array.isArray(c?.toolCalls) && c.toolCalls.length
      ? c.toolCalls.map((t: any) => ({
          id: String(t.id), type: 'function' as const,
          function: { name: String(t.name), arguments: JSON.stringify(t.args ?? {}) },
        }))
      : undefined;
    return { role: 'assistant', content: c?.text || null, ...(calls ? { tool_calls: calls } : {}) };
  }
  return {
    role: 'tool',
    tool_call_id: String(c?.toolCallId ?? ''),
    content: JSON.stringify({ status: c?.status, summary: c?.summary, result: c?.result }),
  };
}
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/agent.test.ts`
Expected: PASS(8 个用例)

- [x] **Step 5: 提交**

```bash
git add workers/src/ai/agent.ts workers/tests/ai/agent.test.ts
git commit -m "feat(ai): ReAct agent 循环(只读阶段)——上下文裁剪/8步熔断/错误自愈/思考流透传"
```

### Task 9: `/api/ai_chat` SSE 端点 + 会话列表端点

**Files:**
- Modify: `workers/src/lib/validate.ts`(追加)
- Modify: `workers/src/handlers/ai.ts`(追加会话 handler)
- Modify: `workers/src/router.ts`(追加 4 个端点)
- Test: `workers/tests/ai/endpoints.test.ts`(追加用例)

- [x] **Step 1: 追加失败测试**(同一 `endpoints.test.ts` 文件内追加)

```ts
describe('AI 会话端点与 ai_chat SSE', () => {
  it('GET /api/ai_conversations 未登录 401 / 登录返回列表', async () => {
    const noauth = await createApp().request(new Request('http://x/api/ai_conversations'), undefined, env as any);
    expect(noauth.status).toBe(401);
    const res = await authed('/api/ai_conversations');
    expect((await res.json()).code).toBe(0);
  });

  it('GET /api/ai_messages?cid= 缺参报业务错误', async () => {
    const res = await authed('/api/ai_messages');
    expect((await res.json()).code).not.toBe(0);
  });

  it('POST /api/ai_chat:未登录 401(流开始前)', async () => {
    const res = await createApp().request(new Request('http://x/api/ai_chat', { method: 'POST' }), undefined, env as any);
    expect(res.status).toBe(401);
  });

  it('POST /api/ai_chat:未配置厂商 → 流开始前即 error 事件(不建会话不留垃圾行)', async () => {
    const fd = new FormData();
    fd.append('cid', '0');
    fd.append('message', 'hi');
    const res = await authed('/api/ai_chat', { method: 'POST', body: fd });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await new Response(res.body).text();
    expect(text).toContain('event: error');
    expect(text).toContain('模型配置');
    expect(text).not.toContain('event: conversation');   // 失败前不建会话
  });

  it('POST /api/ai_chat:厂商不可达 → error 事件(流式链路全通)', async () => {
    // 配一个指向不可达地址的厂商,验证 401 分类之外的网络错误路径
    const payload = {
      providers: [{ id: 'p1', name: 'X', preset: 'custom',
        baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'sk-x', model: 'm', enabled: true }],
      activeProviderId: 'p1', systemPrompt: '',
    };
    await authed('/api/ai_config', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    const fd = new FormData();
    fd.append('cid', '0');
    fd.append('message', 'hi');
    const res = await authed('/api/ai_chat', { method: 'POST', body: fd });
    const text = await new Response(res.body).text();
    expect(text).toContain('event: error');
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/endpoints.test.ts`
Expected: 新增用例 FAIL(404)

- [x] **Step 3: 实现**

`workers/src/lib/validate.ts` 追加:

```ts
export const aiChatSchema = z.object({
  token: z.string().optional(),
  cid: z.coerce.number().int().min(0).optional().default(0),
  message: z.string().max(8192).optional(),
  confirm_message_id: z.coerce.number().int().positive().optional(),
  confirm_action: z.enum(['approve', 'reject']).optional(),
}).refine(v => (v.message && v.message.trim()) || v.confirm_message_id, {
  message: 'message 与 confirm 二选一',
});

export const aiMessagesSchema = z.object({
  token: z.string().optional(),
  cid: z.coerce.number().int().positive(),
});

export const aiDelConversationSchema = z.object({
  token: z.string().optional(),
  id: z.coerce.number().int().positive(),
});
```

`workers/src/handlers/ai.ts` 追加(import 区补):

```ts
import { listConversations, deleteConversation, listMessages } from '../ai/conversations';
import type { WorkerDB } from '../ai/types';

// ...(getAiConfigHandler / saveAiConfigHandler 保持不动)...

export async function listAiConversationsHandler(db: WorkerDB) {
  const rows = await listConversations(db);
  return { code: 0, data: rows.map(r => ({ id: r.id, title: r.title, updated_at: r.updatedAt })) };
}

export async function deleteAiConversationHandler(db: WorkerDB, id: number) {
  await deleteConversation(db, id);
  return { code: 0, data: null };
}

export async function listAiMessagesHandler(db: WorkerDB, cid: number) {
  const msgs = await listMessages(db, cid);
  return { code: 0, data: msgs.map(m => ({ id: m.id, role: m.role, content: m.content, created_at: m.createdAt })) };
}
```

`workers/src/router.ts`:import 区补 `aiChatSchema, aiMessagesSchema, aiDelConversationSchema`(并入既有 validate import)与 `listAiConversationsHandler, deleteAiConversationHandler, listAiMessagesHandler`、`runAgentTurn, TURN_TIMEOUT_MS`(来自 `./ai/agent`)、`OpenAiCompatProvider`(来自 `./ai/provider`)、`loadAiConfig`(来自 `./ai/config`)。`/api/ai_config` 两个端点之后追加:

```ts
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

  // SSE 主端点:鉴权在流开始前(zod 错误走 onError 出 JSON,非流)。
  // 心跳:静默期每 15s 写注释行,防边缘节点掐空闲连接;整轮上限 180s。
  app.post('/api/ai_chat', authMiddleware, async c => {
    const body = await parseBody(c);
    const p = aiChatSchema.parse(body);
    const db = c.get('db');
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]);

    return streamSSE(c, async stream => {
      let closed = false;
      stream.onAbort(() => { closed = true; });
      const hb = setInterval(() => { if (!closed) void stream.write(': hb\n\n').catch(() => {}); }, 15_000);
      const emit = async (ev: ChatSseEvent) => {
        if (closed) return;
        await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
      };
      try {
        const cfg = await loadAiConfig(db);
        await runAgentTurn(
          { db, provider: new OpenAiCompatProvider() }, cfg,
          {
            conversationId: p.cid,
            ...(p.message !== undefined ? { message: p.message } : {}),
            ...(p.confirm_message_id ? { confirm: { messageId: p.confirm_message_id, action: p.confirm_action ?? 'approve' } } : {}),
            emit,
            signal,
          },
        );
      } catch (e) {
        // 客户端断开后的写入失败忽略;真正的业务错误仍要送达
        try {
          await emit({ type: 'error', code: -2000, msg: e instanceof Error ? e.message : 'AI 服务异常' });
        } catch { /* 流已关 */ }
      } finally {
        clearInterval(hb);
      }
    });
  });
```

(router import 区同时补 `import type { ChatSseEvent } from './ai/types';`。)

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/endpoints.test.ts`
Expected: 全部 PASS(配置 4 + 本任务 5)

- [x] **Step 5: 全量回归 + 提交**

Run: `pnpm --filter @navbook/workers test && pnpm --filter @navbook/workers typecheck`
Expected: 全绿

```bash
git add workers/src workers/tests
git commit -m "feat(ai): ai_chat SSE 端点(心跳/180s上限/断连清理)与会话列表端点"
```

### Task 10: shared `chat/machine.ts` — 聊天状态机

**Files:**
- Create: `shared/src/chat/machine.ts`
- Create: `shared/src/chat/machine.test.ts`
- Modify: `shared/src/index.ts`(解开 machine 的 export 注释)

- [x] **Step 1: 写失败测试**

```ts
// shared/src/chat/machine.test.ts
import { describe, it, expect } from 'vitest';
import { ChatMachine } from './machine';
import type { ChatSseEvent, ChatMessageDto, ChatStreamBody } from './types';

function fakeTransport(script: ChatSseEvent[][] = [], log: ChatStreamBody[] = []) {
  let call = 0;
  return {
    log,
    async *stream(body: ChatStreamBody): AsyncGenerator<ChatSseEvent> {
      log.push(body);
      yield* script[call++] ?? [{ type: 'done', messageIds: [] }];
    },
    async history(_cid: number): Promise<ChatMessageDto[]> { return []; },
  };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('ChatMachine', () => {
  it('send:用户消息入列,事件归约成 assistant 文本', async () => {
    const t = fakeTransport([[
      { type: 'conversation', cid: 7, title: 't' },
      { type: 'reasoning', text: '想一下' },
      { type: 'delta', text: '你好' },
      { type: 'delta', text: '!' },
      { type: 'done', messageIds: [1, 2] },
    ]]);
    const m = new ChatMachine(t as any);
    await m.send('hi');
    await flush();
    expect(m.snapshot().conversationId).toBe(7);
    const items = m.snapshot().items;
    expect(items[0]).toMatchObject({ kind: 'user', text: 'hi' });
    expect(items[1]).toMatchObject({ kind: 'assistant', text: '你好!', reasoning: '想一下', streaming: false });
  });

  it('tool_call(pending) → confirm_required → confirm 走 confirm body', async () => {
    const t = fakeTransport([
      [{ type: 'tool_call', id: 'c1', name: 'delete_link', args: { id: 3 }, danger: 'write' },
       { type: 'confirm_required', messageId: 9, id: 'c1', name: 'delete_link', args: { id: 3 }, summary: '删除链接#3' },
       { type: 'done', messageIds: [8, 9] }],
      [{ type: 'tool_result', id: 'c1', name: 'delete_link', ok: true, summary: '已删除', data: { code: 0 } },
       { type: 'delta', text: '删掉了' },
       { type: 'done', messageIds: [10] }],
    ]);
    const m = new ChatMachine(t as any);
    await m.send('删掉链接3');
    await flush();
    const pending = m.snapshot().items.find(i => i.kind === 'tool') as any;
    expect(pending.status).toBe('pending');
    expect(pending.messageId).toBe(9);

    await m.confirm(9, 'approve');
    await flush();
    expect(t.log[1].confirm).toEqual({ message_id: 9, action: 'approve' });
    const done = m.snapshot().items.find(i => i.kind === 'tool') as any;
    expect(done.status).toBe('ok');
  });

  it('reject:pending 卡转 rejected', async () => {
    const t = fakeTransport([
      [{ type: 'tool_call', id: 'c1', name: 'delete_link', args: {}, danger: 'write' },
       { type: 'confirm_required', messageId: 2, id: 'c1', name: 'delete_link', args: {}, summary: 's' },
       { type: 'done', messageIds: [] }],
      [{ type: 'tool_result', id: 'c1', name: 'delete_link', ok: false, summary: '用户取消了该操作', data: null },
       { type: 'done', messageIds: [] }],
    ]);
    const m = new ChatMachine(t as any);
    await m.send('删');
    await flush();
    await m.confirm(2, 'reject');
    await flush();
    expect((m.snapshot().items.find(i => i.kind === 'tool') as any).status).toBe('rejected');
  });

  it('error 事件落 error 状态,流结束', async () => {
    const t = fakeTransport([[{ type: 'error', code: -2000, msg: 'API Key 无效' }, { type: 'done', messageIds: [] }]]);
    const m = new ChatMachine(t as any);
    await m.send('hi');
    await flush();
    expect(m.snapshot().error).toBe('API Key 无效');
    expect(m.snapshot().streaming).toBe(false);
  });

  it('open:历史消息映射为 items(user/assistant/tool 三态)', async () => {
    const dto: ChatMessageDto[] = [
      { id: 1, role: 'user', content: { text: 'hi' }, created_at: 1 },
      { id: 2, role: 'assistant', content: { text: '查一下', reasoning: '', toolCalls: [{ id: 'c1', name: 'search_links', args: {} }] }, created_at: 2 },
      { id: 3, role: 'tool', content: { toolCallId: 'c1', name: 'search_links', args: {}, status: 'ok', summary: '3 条', result: { code: 0 } }, created_at: 3 },
      { id: 4, role: 'assistant', content: { text: '共 3 条', reasoning: '', toolCalls: [] }, created_at: 4 },
    ];
    const m = new ChatMachine({ stream: async function* () {}, history: async () => dto } as any);
    await m.open(5);
    expect(m.snapshot().conversationId).toBe(5);
    const kinds = m.snapshot().items.map(i => i.kind);
    expect(kinds).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect((m.snapshot().items[2] as any).status).toBe('ok');
  });

  it('abort:停止后 streaming=false,不再消费事件', async () => {
    const t = fakeTransport([[{ type: 'delta', text: 'a' }, { type: 'delta', text: 'b' }, { type: 'done', messageIds: [] }]]);
    const m = new ChatMachine(t as any);
    const p = m.send('hi');
    m.abort();
    await p;
    await flush();
    expect(m.snapshot().streaming).toBe(false);
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navbook/shared exec vitest run src/chat/machine.test.ts`
Expected: FAIL(模块不存在)

- [x] **Step 3: 实现**

```ts
// shared/src/chat/machine.ts
// UI 无关的聊天状态机:send/confirm/abort 驱动 SSE 事件归约成 items。
// web 与 compass 只做 UI 壳(useSyncExternalStore 订阅 snapshot)。
import type { ChatMessageDto, ChatSseEvent, ChatStreamBody } from './types';

export interface ChatTransport {
  history(cid: number): Promise<ChatMessageDto[]>;
  stream(body: ChatStreamBody, signal?: AbortSignal): AsyncGenerator<ChatSseEvent>;
}

export type UiItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; id: number | null; text: string; reasoning: string; streaming: boolean }
  | {
      kind: 'tool'; id: string; name: string; args: unknown;
      danger: 'read' | 'write';
      status: 'running' | 'ok' | 'error' | 'pending' | 'rejected';
      summary: string; data?: unknown; messageId?: number;
    };

export interface ChatSnapshot {
  conversationId: number | null;
  items: UiItem[];
  streaming: boolean;
  error: string | null;
}

export class ChatMachine {
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private state: ChatSnapshot = { conversationId: null, items: [], streaming: false, error: null };

  constructor(private transport: ChatTransport) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  snapshot = () => this.state;
  private set(patch: Partial<ChatSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** 载入历史(或 cid=null 开新会话清空) */
  async open(cid: number | null) {
    this.abort();
    if (cid == null) {
      this.set({ conversationId: null, items: [], streaming: false, error: null });
      return;
    }
    const msgs = await this.transport.history(cid);
    this.set({ conversationId: cid, items: msgs.map(toItem), streaming: false, error: null });
  }

  async send(text: string) {
    if (!text.trim() || this.state.streaming) return;
    await this.streamOnce({ text }, item => [
      { kind: 'user', text } as UiItem, item,
    ]);
  }

  /** 确认/拒绝写操作(对话里不再插用户消息) */
  async confirm(messageId: number, action: 'approve' | 'reject') {
    if (this.state.streaming) return;
    await this.streamOnce({ confirm: { message_id: messageId, action } }, item => [item]);
  }

  abort() {
    this.controller?.abort();
    this.controller = null;
  }

  private async streamOnce(
    body: { text?: string; confirm?: ChatStreamBody['confirm'] },
    seed: (placeholder: UiItem) => UiItem[],
  ) {
    this.controller = new AbortController();
    const assistant: UiItem = { kind: 'assistant', id: null, text: '', reasoning: '', streaming: true };
    this.set({
      items: seed(assistant),
      streaming: true,
      error: null,
    });
    try {
      for await (const ev of this.transport.stream(
        {
          cid: this.state.conversationId ?? 0,
          ...(body.text !== undefined ? { message: body.text } : {}),
          ...(body.confirm ? { confirm: body.confirm } : {}),
        },
        this.controller.signal,
      )) {
        this.reduce(ev);
        if (!this.state.streaming && ev.type === 'done') break;
      }
    } catch {
      // abort(用户停止)或网络断:就地收尾
      this.finishStreaming();
    }
    this.finishStreaming();
  }

  private finishStreaming() {
    if (!this.state.streaming) return;
    const items = this.state.items.map(i =>
      i.kind === 'assistant' && i.streaming ? { ...i, streaming: false } : i);
    this.set({ items, streaming: false });
  }

  private reduce(ev: ChatSseEvent) {
    const items = [...this.state.items];
    const lastAssistant = () => {
      let idx = -1;
      for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'assistant') { idx = i; break; }
      return idx;
    };
    switch (ev.type) {
      case 'conversation':
        this.set({ conversationId: ev.cid });
        return;
      case 'delta': {
        const i = lastAssistant();
        if (i >= 0) items[i] = { ...(items[i] as Extract<UiItem, { kind: 'assistant' }>), text: (items[i] as any).text + ev.text };
        this.set({ items });
        return;
      }
      case 'reasoning': {
        const i = lastAssistant();
        if (i >= 0) items[i] = { ...(items[i] as any), reasoning: (items[i] as any).reasoning + ev.text };
        this.set({ items });
        return;
      }
      case 'tool_call':
        items.push({
          kind: 'tool', id: ev.id, name: ev.name, args: ev.args, danger: ev.danger,
          status: ev.danger === 'write' ? 'pending' : 'running', summary: '',
        });
        this.set({ items });
        return;
      case 'tool_result': {
        const i = items.findIndex(x => x.kind === 'tool' && x.id === ev.id);
        if (i >= 0) {
          items[i] = {
            ...(items[i] as Extract<UiItem, { kind: 'tool' }>),
            status: ev.ok ? 'ok' : (items[i] as any).danger === 'write' && !ev.ok && ev.summary.includes('取消') ? 'rejected' : 'error',
            summary: ev.summary, data: ev.data,
          };
        }
        this.set({ items });
        return;
      }
      case 'confirm_required': {
        const i = items.findIndex(x => x.kind === 'tool' && x.id === ev.id);
        if (i >= 0) items[i] = { ...(items[i] as any), status: 'pending', summary: ev.summary, messageId: ev.messageId };
        this.set({ items });
        return;
      }
      case 'error':
        this.set({ items, error: ev.msg });
        return;
      case 'done':
        this.set({ items });
        this.finishStreaming();
        return;
    }
  }
}

function toItem(m: ChatMessageDto): UiItem {
  const c = m.content as any;
  if (m.role === 'user') return { kind: 'user', text: c.text ?? '' };
  if (m.role === 'assistant') {
    return { kind: 'assistant', id: m.id, text: c.text ?? '', reasoning: c.reasoning ?? '', streaming: false };
  }
  return {
    kind: 'tool', id: c.toolCallId ?? '', name: c.name ?? '', args: c.args,
    danger: 'read',                     // 历史回放不区分 danger(渲染不依赖)
    status: c.status ?? 'ok', summary: c.summary ?? '', data: c.result,
  };
}
```

`shared/src/index.ts` 解开注释:

```ts
export { ChatMachine } from './chat/machine';
export type { ChatTransport, UiItem, ChatSnapshot } from './chat/machine';
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navbook/shared exec vitest run src/chat/`
Expected: machine 6 用例 + sse 3 用例全 PASS

- [x] **Step 5: 提交**

```bash
git add shared/src
git commit -m "feat(shared): ChatMachine 聊天状态机(事件归约/确认流/abort/历史映射)"
```

### Task 11: web AI 助手聊天页

**Files:**
- Create: `web/src/components/assistant/ChatMessages.tsx`(消息区渲染,含确认卡/思考块/工具卡)
- Create: `web/src/routes/Admin/Assistant.tsx`(会话列表 + 聊天区 + 输入)
- Modify: `web/src/api/client.ts`(追加会话方法)
- Modify: `web/src/App.tsx`(注册 `/admin/assistant` 路由;若 Task 3 未挂菜单,现在把 Layout NAV_SECTIONS 的 AI 分组补全)

- [x] **Step 1: client.ts 追加方法**(api 对象内)

```ts
  aiConversations: () => get('/api/ai_conversations'),
  delAiConversation: (id: number) => post('ai_del_conversation', { id }),
  aiMessages: (cid: number) => get(`/api/ai_messages?cid=${cid}`),
```

- [x] **Step 2: 消息区组件**

```tsx
// web/src/components/assistant/ChatMessages.tsx
// 纯渲染:吃 ChatSnapshot.items,输出聊天气泡/思考折叠块/工具卡/确认卡。
import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import type { UiItem } from '@navbook/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ChatMessages({
  items, streaming, onConfirm,
}: {
  items: UiItem[]; streaming: boolean;
  onConfirm: (messageId: number, action: 'approve' | 'reject') => void;
}) {
  return (
    <div className="space-y-4">
      {items.map((item, i) => {
        if (item.kind === 'user') {
          return (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
                {item.text}
              </div>
            </div>
          );
        }
        if (item.kind === 'assistant') return <AssistantBubble key={i} item={item} />;
        return <ToolCard key={i} item={item} onConfirm={onConfirm} />;
      })}
      {streaming && items.at(-1)?.kind !== 'assistant' && (
        <div className="text-xs text-muted-foreground">思考中…</div>
      )}
    </div>
  );
}

function AssistantBubble({ item }: { item: Extract<UiItem, { kind: 'assistant' }> }) {
  const [openThinking, setOpenThinking] = useState(false);
  return (
    <div className="space-y-2">
      {item.reasoning && (
        <div className="rounded-lg border border-dashed border-border bg-muted/40">
          <button
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground"
            onClick={() => setOpenThinking(v => !v)}
          >
            {openThinking ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            思考过程
          </button>
          {openThinking && (
            <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap px-3 pb-2 text-xs text-muted-foreground">
              {item.reasoning}
            </pre>
          )}
        </div>
      )}
      <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
        {item.text || (item.streaming ? '…' : '')}
      </div>
    </div>
  );
}

const TOOL_STATUS = {
  running: { label: '执行中', cls: 'text-muted-foreground', Icon: Wrench },
  ok: { label: '完成', cls: 'text-emerald-600', Icon: CheckCircle2 },
  error: { label: '失败', cls: 'text-destructive', Icon: XCircle },
  rejected: { label: '已取消', cls: 'text-muted-foreground', Icon: XCircle },
  pending: { label: '待确认', cls: 'text-amber-600', Icon: ShieldAlert },
} as const;

function ToolCard({
  item, onConfirm,
}: {
  item: Extract<UiItem, { kind: 'tool' }>;
  onConfirm: (messageId: number, action: 'approve' | 'reject') => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const st = TOOL_STATUS[item.status];
  const detail = item.status === 'pending' ? item.summary : item.summary;
  return (
    <div className={cn('max-w-[85%] rounded-xl border px-3.5 py-2.5 text-sm',
      item.status === 'pending' ? 'border-amber-500/60 bg-amber-500/5' : 'border-border bg-background')}>
      <div className="flex items-center gap-2 text-xs">
        <st.Icon size={14} className={st.cls} />
        <span className="font-medium">{item.name}</span>
        <span className={st.cls}>{st.label}</span>
        {item.status !== 'pending' && (
          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setShowRaw(v => !v)}>
            {showRaw ? '收起' : '详情'}
          </button>
        )}
      </div>
      {item.summary && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
      {showRaw && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed">
          {JSON.stringify({ args: item.args, result: item.data }, null, 2)}
        </pre>
      )}
      {item.status === 'pending' && item.messageId != null && (
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" onClick={() => onConfirm(item.messageId!, 'approve')}>确认执行</Button>
          <Button size="sm" variant="outline" onClick={() => onConfirm(item.messageId!, 'reject')}>取消</Button>
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 3: 聊天页**

```tsx
// web/src/routes/Admin/Assistant.tsx
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChatMachine, parseSseStream } from '@navbook/shared';
import type { ChatMessageDto, ChatSseEvent, UiItem } from '@navbook/shared';
import { api } from '@/api/client';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { ChatMessages } from '@/components/assistant/ChatMessages';
import { Plus, Send, Square, Trash2 } from 'lucide-react';

/** web 侧传输层:普通端点走 api client,SSE 走 shared 解析器 */
const machine = new ChatMachine({
  history: async (cid: number): Promise<ChatMessageDto[]> =>
    (await api.aiMessages(cid)).data,
  stream: async function* (body, signal) {
    const fd = new FormData();
    fd.append('cid', String(body.cid));
    if (body.message !== undefined) fd.append('message', body.message);
    if (body.confirm) {
      fd.append('confirm_message_id', String(body.confirm.message_id));
      fd.append('confirm_action', body.confirm.action);
    }
    const res = await fetch('/api/ai_chat', { method: 'POST', body: fd, signal });
    if (res.status === 401) { location.href = '/admin/login'; throw new Error('未登录'); }
    if (!res.ok || !res.body) throw new Error(`AI 服务异常(HTTP ${res.status})`);
    for await (const { event, data } of parseSseStream(res.body)) {
      if (event === 'hb') continue;
      yield JSON.parse(data) as ChatSseEvent;
    }
  },
});

export function AdminAssistant() {
  const qc = useQueryClient();
  const snap = useSyncExternalStore(machine.subscribe, machine.snapshot);
  const [input, setInput] = useState('');
  const [showList, setShowList] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const conversations = useQuery({
    queryKey: ['ai-conversations'],
    queryFn: () => api.aiConversations() as Promise<{ data: Array<{ id: number; title: string; updated_at: number }> }>,
  });

  // 进入页面:无选中会话时续接最近一个
  useEffect(() => {
    if (machine.snapshot().conversationId == null && conversations.data?.data.length) {
      void machine.open(conversations.data.data[0].id);
    }
  }, [conversations.data]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [snap.items.length, snap.items.at(-1)]);

  const onSend = async () => {
    const text = input.trim();
    if (!text || snap.streaming) return;
    setInput('');
    await machine.send(text);
    void qc.invalidateQueries({ queryKey: ['ai-conversations'] });
  };

  const onConfirm = async (messageId: number, action: 'approve' | 'reject') => {
    await machine.confirm(messageId, action);
    void qc.invalidateQueries({ queryKey: ['ai-conversations'] });
  };

  const onNew = async () => { await machine.open(null); };
  const onSelect = async (cid: number) => { await machine.open(cid); };
  const onDelete = async (cid: number) => {
    try {
      await api.delAiConversation(cid);
      if (machine.snapshot().conversationId === cid) await machine.open(null);
      void qc.invalidateQueries({ queryKey: ['ai-conversations'] });
    } catch (e) { toast.error(e instanceof Error ? e.message : '删除失败'); }
  };

  const list = conversations.data?.data ?? [];

  return (
    <div className="flex h-full gap-5">
      {showList && (
        <aside className="flex w-60 shrink-0 flex-col rounded-xl border border-border bg-card">
          <div className="p-3">
            <Button size="sm" className="w-full" onClick={onNew}><Plus size={14} />新会话</Button>
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            {list.map(c => (
              <div key={c.id}
                className={'group flex items-center gap-1 rounded-lg px-2 ' +
                  (snap.conversationId === c.id ? 'bg-primary/10' : 'hover:bg-muted')}>
                <button className="flex-1 truncate py-2 text-left text-[13px]" onClick={() => onSelect(c.id)}>
                  {c.title || '(未命名)'}
                </button>
                <button className="opacity-0 transition group-hover:opacity-100" onClick={() => onDelete(c.id)}>
                  <Trash2 size={14} className="text-destructive" />
                </button>
              </div>
            ))}
            {!list.length && <p className="px-2 py-4 text-xs text-muted-foreground">还没有会话</p>}
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <PageHeader title="AI 助手" desc="" />
          <Button variant="ghost" size="sm" onClick={() => setShowList(v => !v)}>
            {showList ? '隐藏会话列表' : '显示会话列表'}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <ChatMessages items={snap.items} streaming={snap.streaming} onConfirm={onConfirm} />
          {snap.error && (
            <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {snap.error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex items-end gap-2 border-t border-border p-3">
          <textarea
            className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            rows={1}
            value={input}
            placeholder={snap.conversationId == null ? '开始新对话…' : '输入消息,Enter 发送 / Shift+Enter 换行'}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void onSend(); }
            }}
          />
          {snap.streaming
            ? <Button variant="outline" onClick={() => machine.abort()}><Square size={14} />停止</Button>
            : <Button onClick={onSend} disabled={!input.trim()}><Send size={14} />发送</Button>}
        </div>
      </div>
    </div>
  );
}
```

注意:`PageHeader` 若含大标题/外边距与卡片头部不搭,此处可换成纯 `<span className="text-sm font-medium">AI 助手</span>`——执行者按页面实际渲染效果二选一,选简单的。

`web/src/App.tsx` 注册:`import { AdminAssistant } from './routes/Admin/Assistant';` + `settings` 之后:

```tsx
            <Route path="assistant" element={<AdminAssistant />} />
```

`Layout.tsx` NAV_SECTIONS 的 AI 分组(Task 3 已建则确认完整;未建则现在建,import 补 `Sparkles, Bot`):

```ts
  {
    label: 'AI 助手',
    items: [
      { to: '/admin/assistant', label: 'AI 助手', icon: Sparkles },
      { to: '/admin/ai-config', label: '模型配置', icon: Bot },
    ],
  },
```

- [x] **Step 4: 构建验证**

Run: `pnpm --filter web build`
Expected: 成功

- [x] **Step 5: 手动验证(需真实厂商 key)**

本地 `pnpm --filter @navbook/workers dev` + `pnpm --filter web dev`:模型配置页配好 key → AI 助手页发"我站里有哪些分类?" → 观察:思考块折叠、工具卡执行、流式文本、会话列表自动出标题。**无 key 时也应看到明确错误提示文案。**

- [x] **Step 6: 提交**

```bash
git add web/src
git commit -m "feat(web): AI 助手聊天页(会话列表/流式消息/思考折叠/工具卡/停止重试)"
```

---

## Phase 3 写工具 + 确认机制

(前端确认卡已在 Task 11 的 `ChatMessages`/`ToolCard` 内置——pending 状态渲染「确认执行/取消」,`onConfirm` 直连 machine.confirm。本阶段只需后端补齐。)

### Task 12: 6 个写工具

**Files:**
- Modify: `workers/src/ai/tools.ts`(AI_TOOLS 追加,删除过渡 re-export 行)
- Test: `workers/tests/ai/tools.test.ts`(追加)

- [x] **Step 1: 追加失败测试**

```ts
// workers/tests/ai/tools.test.ts 追加
describe('write tools', () => {
  it('六个写工具全部注册且 danger=write', () => {
    const writes = AI_TOOLS.filter(t => t.danger === 'write').map(t => t.name);
    expect(writes).toEqual([
      'create_link', 'update_link', 'delete_link',
      'create_category', 'update_category', 'delete_category',
    ]);
  });

  it('create_link 落库且 summarize 预执行文案含标题', async () => {
    const cat = await seed();
    const tool = findTool('create_link')!;
    expect(tool.summarize({ title: 'V2EX', url: 'https://v2ex.com', category_id: cat.id }, null))
      .toContain('V2EX');
    const res: any = await tool.execute(db(), { title: 'V2EX', url: 'https://v2ex.com', category_id: cat.id });
    expect(res.code).toBe(0);
  });

  it('update_link 部分字段:未提供的字段保持原值', async () => {
    const cat = await seed();   // 已有 GitHub 链接
    const before: any = await findTool('get_link')!.execute(db(), { id: 1 });
    const res: any = await findTool('update_link')!.execute(db(), { id: 1, description: '全球最大同性交友平台' });
    expect(res.code).toBe(0);
    const after: any = await findTool('get_link')!.execute(db(), { id: 1 });
    expect(after.data.description).toBe('全球最大同性交友平台');
    expect(after.data.title).toBe(before.data.title);   // 未传 title 不变
  });

  it('delete_link 删除后查无', async () => {
    await seed();
    const res: any = await findTool('delete_link')!.execute(db(), { id: 1 });
    expect(res.code).toBe(0);
    const gone: any = await findTool('get_link')!.execute(db(), { id: 1 });
    expect(gone.code).not.toBe(0);
  });

  it('update_category 改名;delete_category 有链接时业务报错(喂回模型)', async () => {
    await seed();
    const up: any = await findTool('update_category')!.execute(db(), { id: 1, name: '开发工具' });
    expect(up.code).toBe(0);
    const del: any = await findTool('delete_category')!.execute(db(), { id: 1 });
    expect(del.code).not.toBe(0);   // delCategoryHandler throw → execTool 转错误结果
  });
});
```

(`delete_category` 的 throw 断言依赖 agent 的 execTool 包装,单测 execute 层面直接断言 `rejects.toThrow`:)

```ts
  it('delete_category 有链接时 throw(经 agent 包装为错误 tool 结果)', async () => {
    await seed();
    await expect(findTool('delete_category')!.execute(db(), { id: 1 }))
      .rejects.toThrow('此分类下存在链接');
  });
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/tools.test.ts`
Expected: 新增用例 FAIL

- [x] **Step 3: 实现**

`workers/src/ai/tools.ts`:import 区补 `addLinkHandler, editLinkHandler, delLinkHandler`、`addCategoryHandler, editCategoryHandler, delCategoryHandler`,删除文件末尾 `export { getACategoryHandler };` 过渡行。在 `const s = ...` 行旁补工具函数:

```ts
const int = (v: unknown, dflt = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
```

`AI_TOOLS` 数组的 `get_site_config` 条目之后、`];` 之前追加(纯对象字面量):

```ts
// ---- 写操作(danger:'write'):执行由 agent 走人工确认流,execute 只在被确认后调用 ----
{
  name: 'create_link',
  description: '新增书签链接。需要标题、URL、分类 id(可先用 list_categories 查)。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      url: { type: 'string' },
      category_id: { type: 'number' },
      description: { type: 'string', description: '备注,可选' },
      property: { type: 'number', enum: [0, 1], description: '0=公开(默认) 1=私密' },
    },
    required: ['title', 'url', 'category_id'],
  },
  danger: 'write',
  summarize: (a, r) => r
    ? `已新增链接「${a.title}」${r && typeof r === 'object' && 'id' in r ? `(#${(r as any).id})` : ''}`
    : `新增链接「${a.title}」→ ${a.url}${a.property === 1 ? '(私密)' : ''}`,
  execute: (db, a) => addLinkHandler(db, {
    fid: int(a.category_id, 1), title: String(a.title ?? ''), url: String(a.url ?? ''),
    description: String(a.description ?? ''), weight: 0, property: int(a.property),
    url_standby: '', font_icon: '',
  }),
},
{
  name: 'update_link',
  description: '修改链接。只传要改的字段,未传字段保持原值(id 必传)。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number' },
      title: { type: 'string' }, url: { type: 'string' },
      category_id: { type: 'number' }, description: { type: 'string' },
      property: { type: 'number', enum: [0, 1] },
    },
    required: ['id'],
  },
  danger: 'write',
  summarize: (a) => `修改链接 #${a.id}:${[a.title && '标题', a.url && 'URL', a.category_id && '分类', a.description && '描述', a.property !== undefined && '属性'].filter(Boolean).join('/') || '(无变更)'}`,
  execute: async (db, a) => {
    const cur: any = await getALinkHandler(db, int(a.id), true);
    if (cur.code !== 0 || !cur.data) return cur;
    const r = cur.data;
    return editLinkHandler(db, int(a.id), {
      fid: a.category_id !== undefined ? int(a.category_id) : r.fid,
      title: a.title !== undefined ? String(a.title) : r.title,
      url: a.url !== undefined ? String(a.url) : r.url,
      description: a.description !== undefined ? String(a.description) : (r.description ?? ''),
      weight: r.weight ?? 0,
      property: a.property !== undefined ? int(a.property) : r.property,
      url_standby: r.urlStandby ?? '', font_icon: r.fontIcon ?? '',
    });
  },
},
{
  name: 'delete_link',
  description: '删除链接(不可恢复,需用户确认)。',
  parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
  danger: 'write',
  summarize: (a, r) => r ? `已删除链接 #${a.id}` : `删除链接 #${a.id}`,
  execute: (db, a) => delLinkHandler(db, int(a.id)),
},
{
  name: 'create_category',
  description: '新增分类。fid 为父分类 id(顶级传 0 或不传)。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      property: { type: 'number', enum: [0, 1] },
      parent_id: { type: 'number', description: '父分类 id,顶级省略' },
    },
    required: ['name'],
  },
  danger: 'write',
  summarize: (a, r) => r
    ? `已新增分类「${a.name}」`
    : `新增分类「${a.name}」${a.parent_id ? `(父分类 #${a.parent_id})` : ''}${a.property === 1 ? '(私密)' : ''}`,
  execute: (db, a) => addCategoryHandler(db, {
    name: String(a.name ?? ''), property: int(a.property), weight: 0,
    description: String(a.description ?? ''), font_icon: '', fid: a.parent_id !== undefined ? int(a.parent_id) : 0,
  }),
},
{
  name: 'update_category',
  description: '修改分类。只传要改的字段(id 必传)。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number' }, name: { type: 'string' },
      description: { type: 'string' }, property: { type: 'number', enum: [0, 1] },
    },
    required: ['id'],
  },
  danger: 'write',
  summarize: (a) => `修改分类 #${a.id}:${a.name ? `改名为「${a.name}」` : '更新字段'}`,
  execute: async (db, a) => {
    const cur: any = await getACategoryHandler(db, int(a.id), true);
    if (cur.code !== 0 || !cur.data) return cur;
    const r = cur.data;
    return editCategoryHandler(db, int(a.id), {
      name: a.name !== undefined ? String(a.name) : r.name,
      property: a.property !== undefined ? int(a.property) : r.property,
      weight: r.weight ?? 0,
      description: a.description !== undefined ? String(a.description) : (r.description ?? ''),
      font_icon: r.fontIcon ?? '', fid: r.fid ?? 0,
    });
  },
},
{
  name: 'delete_category',
  description: '删除分类。要求其下无子分类且无链接(否则会失败并告知原因)。',
  parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
  danger: 'write',
  summarize: (a) => `删除分类 #${a.id}`,
  execute: (db, a) => delCategoryHandler(db, int(a.id)),
},
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/tools.test.ts`
Expected: 全部 PASS

- [x] **Step 5: 提交**

```bash
git add workers/src/ai/tools.ts workers/tests/ai/tools.test.ts
git commit -m "feat(ai): 6个写工具(增删改链接/分类),update 支持部分字段合并"
```

### Task 13: agent 确认流(pending → approve/reject → 恢复循环)

**Files:**
- Modify: `workers/src/ai/agent.ts`
- Test: `workers/tests/ai/agent.test.ts`(追加)

- [x] **Step 1: 追加失败测试**

```ts
// workers/tests/ai/agent.test.ts 追加
import { listMessages } from '../../src/ai/conversations';

describe('runAgentTurn(写工具确认流)', () => {
  it('写工具 → confirm_required(不执行),pending 消息落库', async () => {
    const provider = new FakeProvider([[
      { type: 'tool_call', call: { id: 'c1', name: 'delete_link', args: '{"id":1}' } },
      { type: 'finish', reason: 'tool_calls' },
    ]]);
    const events = await collectEvents(provider, { message: '删掉链接1' });
    const cf = events.find(e => e.type === 'confirm_required') as any;
    expect(cf).toBeTruthy();
    expect(cf.name).toBe('delete_link');
    expect(cf.summary).toContain('删除链接 #1');
    // 库里是 pending,且链接没被删
    const convId = (events.find(e => e.type === 'conversation') as any)?.cid;
    const msgs = await listMessages(db(), convId);
    const toolMsg = msgs.find(m => m.role === 'tool')!;
    expect((toolMsg.content as any).status).toBe('pending');
  });

  it('approve:执行工具 → tool_result → 循环继续到最终回答', async () => {
    const cat = await addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    await addLinkHandler(db(), { fid: cat.id, title: 'GitHub', url: 'https://github.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
    const provider = new FakeProvider([[
      { type: 'tool_call', call: { id: 'c1', name: 'delete_link', args: '{"id":1}' } },
      { type: 'finish', reason: 'tool_calls' },
    ]]);
    const events = await collectEvents(provider, { message: '删掉链接1' });
    const cf = events.find(e => e.type === 'confirm_required') as any;
    const convId = (events.find(e => e.type === 'conversation') as any).cid;

    // 确认:新一轮(provider 提供最终回答)
    (provider as any).turns.push([{ type: 'text', delta: '已删除' }, { type: 'finish', reason: 'stop' }]);
    const events2: ChatSseEvent[] = [];
    await runAgentTurn({ db: db(), provider }, { providers: [], activeProviderId: null, systemPrompt: '' }, {
      conversationId: convId,
      confirm: { messageId: cf.messageId, action: 'approve' },
      emit: async e => { events2.push(e); },
    });
    const tr = events2.find(e => e.type === 'tool_result') as any;
    expect(tr.ok).toBe(true);
    expect(events2.some(e => e.type === 'delta')).toBe(true);
    // 链接真的没了
    const { getALinkHandler } = await import('../../src/handlers/link');
    expect((await getALinkHandler(db(), 1, true) as any).code).not.toBe(0);
  });

  it('reject:pending → rejected,模型收到拒绝并继续对话', async () => {
    const provider = new FakeProvider([[
      { type: 'tool_call', call: { id: 'c1', name: 'delete_link', args: '{"id":1}' } },
      { type: 'finish', reason: 'tool_calls' },
    ]]);
    const events = await collectEvents(provider, { message: '删掉链接1' });
    const cf = events.find(e => e.type === 'confirm_required') as any;
    const convId = (events.find(e => e.type === 'conversation') as any).cid;

    (provider as any).turns.push([{ type: 'text', delta: '好的,不删了' }, { type: 'finish', reason: 'stop' }]);
    const events2: ChatSseEvent[] = [];
    await runAgentTurn({ db: db(), provider }, { providers: [], activeProviderId: null, systemPrompt: '' }, {
      conversationId: convId,
      confirm: { messageId: cf.messageId, action: 'reject' },
      emit: async e => { events2.push(e); },
    });
    const tr = events2.find(e => e.type === 'tool_result') as any;
    expect(tr.ok).toBe(false);
    expect(tr.summary).toContain('取消');
    // 模型侧第二轮上下文里有 rejected 结果
    const toolMsg = provider.calls.at(-1)!.find(m => m.role === 'tool');
    expect(toolMsg?.content).toContain('rejected');
  });

  it('confirm 的 messageId 不属于 pending 工具消息 → error', async () => {
    const { createConversation, insertMessage } = await import('../../src/ai/conversations');
    const conv = await createConversation(db(), 't');
    const u = await insertMessage(db(), conv.id, 'user', { text: 'x' });
    const events: ChatSseEvent[] = [];
    await runAgentTurn({ db: db(), provider: new FakeProvider([]) }, { providers: [], activeProviderId: null, systemPrompt: '' }, {
      conversationId: conv.id,
      confirm: { messageId: u.id, action: 'approve' },
      emit: async e => { events.push(e); },
    });
    expect(events.some(e => e.type === 'error')).toBe(true);
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/agent.test.ts`
Expected: 新增 4 用例中前三个 FAIL(pending 已落库但 confirm 不恢复/不执行)

- [x] **Step 3: 实现**

`workers/src/ai/agent.ts`:`runAgentTurn` 中 `if (opts.message !== undefined)` 块之前插入 confirm 处理,并新增内部函数:

```ts
  // ---- 写工具确认恢复:执行/拒绝后带着结果继续循环 ----
  if (opts.confirm) {
    const msgs = await listMessages(db, cid);
    const msg = msgs.find(m => m.id === opts.confirm!.messageId);
    const c = msg?.content as any;
    if (msg?.role !== 'tool' || c?.status !== 'pending') {
      return fail('确认目标不存在或已处理,请重新发起');
    }
    const tool = findTool(c.name);
    if (opts.confirm.action === 'approve' && tool) {
      const { content } = await execTool(db, tool, { id: c.toolCallId, name: c.name, args: c.args });
      await updateMessageContent(db, msg.id, content);
      await emit({
        type: 'tool_result', id: content.toolCallId, name: content.name,
        ok: content.status === 'ok', summary: content.summary, data: content.result,
      });
    } else {
      const content: ToolMsgContent = {
        ...c, status: 'rejected', summary: '用户取消了该操作',
        result: { code: -2000, msg: '用户取消了该操作' },
      };
      await updateMessageContent(db, msg.id, content);
      await emit({
        type: 'tool_result', id: c.toolCallId, name: c.name,
        ok: false, summary: content.summary, data: content.result,
      });
    }
  }
```

同文件 import 区补 `updateMessageContent`(并入 conversations import)。既有 for 循环内的 `if (tool.danger === 'write')` 分支保持不变——Task 8 已预埋(confirm_required 发出 + pending 落库 + 本轮 done),本任务让恢复路径闭环。

- [x] **Step 4: 跑测试确认通过 + 全量回归**

Run: `pnpm --filter @navbook/workers exec vitest run tests/ai/ && pnpm --filter @navbook/workers test`
Expected: 全部 PASS

- [x] **Step 5: 手动验证**

管理端聊天页:配好真实 key → 发"帮我把 GitHub 那条链接改成私密" → 出确认卡(取消一次,观察模型反应;再确认一次,观察执行与续答)→ 到链接管理页核对数据真的变了。

- [x] **Step 6: 提交**

```bash
git add workers/src/ai/agent.ts workers/tests/ai/agent.test.ts
git commit -m "feat(ai): 写工具人工确认流(pending/confirm_required/approve/reject 闭环)"
```

---

## Phase 4 主题页气泡(compass)

### Task 14: shared `createApiClient` 扩展(AI 端点 + SSE 流)

**Files:**
- Modify: `shared/src/index.ts`

- [x] **Step 1: 实现**

`createApiClient` 的 return 对象替换为(保留 `publicNav`/`session`,注释「未来生长点」删除),并在函数体内 `get` 之后补 `post`/`streamChat`:

```ts
  // FormData POST(与 workers 端点习惯一致;shared 此前只有 get,本计划首次补 post)
  async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    const fd = new FormData();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) fd.append(k, String(v));
    }
    const res = await fetch(path, { method: 'POST', body: fd });
    const json = await res.json().catch(() => { throw new ApiError(res.status, -1, '响应不是 JSON'); });
    if (res.status === 401) {
      const err = new ApiError(401, json?.code ?? -1002, json?.msg ?? '未登录');
      handle401(err);
      throw err;
    }
    if (json && typeof json === 'object' && 'code' in json && json.code !== 0) {
      throw new ApiError(res.status, json.code, json.msg ?? `错误码 ${json.code}`);
    }
    return json as T;
  }

  // SSE:鉴权失败在流开始前是普通 401 JSON(端点设计如此)
  async function* streamChat(
    body: ChatStreamBody, signal?: AbortSignal,
  ): AsyncGenerator<ChatSseEvent> {
    const fd = new FormData();
    fd.append('cid', String(body.cid));
    if (body.message !== undefined) fd.append('message', body.message);
    if (body.confirm) {
      fd.append('confirm_message_id', String(body.confirm.message_id));
      fd.append('confirm_action', body.confirm.action);
    }
    const res = await fetch('/api/ai_chat', { method: 'POST', body: fd, signal });
    if (res.status === 401) {
      const err = new ApiError(401, -1002, '未登录');
      handle401(err);
      throw err;
    }
    if (!res.ok || !res.body) throw new ApiError(res.status, -1, `AI 服务异常(HTTP ${res.status})`);
    for await (const { event, data } of parseSseStream(res.body)) {
      if (event === 'hb') continue;
      yield JSON.parse(data) as ChatSseEvent;
    }
  }

  return {
    publicNav: () => get<{ code: 0; data: NavData }>('/api/public_nav').then(r => r.data),
    session: () => get<{ code: 0; data: SessionInfo }>('/api/session'),
    aiConversations: () => get<{ code: 0; data: ConversationDto[] }>('/api/ai_conversations'),
    aiMessages: (cid: number) => get<{ code: 0; data: ChatMessageDto[] }>(`/api/ai_messages?cid=${cid}`),
    delAiConversation: (id: number) => post('/api/ai_del_conversation', { id }),
    streamChat,
  };
```

import 区补:`import { parseSseStream } from './chat/sse';` 与 `import type { ChatSseEvent, ChatStreamBody, ConversationDto, ChatMessageDto } from './chat/types';`(index.ts 同文件 re-export 已有,直接用相对路径 import)。

- [x] **Step 2: shared 全量测试回归**

Run: `pnpm --filter @navbook/shared test`
Expected: PASS(纯类型改动 + 新增方法,无既有用例破坏;web build 在 Task 15 一并验证)

- [x] **Step 3: 提交**

```bash
git add shared/src/index.ts
git commit -m "feat(shared): createApiClient 补 FormData post 与 ai_chat SSE 流(主题端可消费)"
```

### Task 15: compass 右下角气泡(仅登录态渲染)

**Files:**
- Create: `themes/compass/src/components/AssistantBubble.tsx`
- Modify: `themes/compass/src/App.tsx`(挂载)

- [x] **Step 1: 气泡组件**

```tsx
// themes/compass/src/components/AssistantBubble.tsx
// 仅登录管理员可见(session.username 存在才渲染);compass 自有 token 体系,不引 shadcn。
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ChatMachine, createApiClient,
} from '@navbook/shared';
import type { ChatMessageDto, ChatSseEvent, SessionInfo, UiItem } from '@navbook/shared';

const api = createApiClient({ onUnauthorized: false });

const machine = new ChatMachine({
  history: async (cid: number): Promise<ChatMessageDto[]> => (await api.aiMessages(cid)).data,
  stream: (body, signal) => api.streamChat(body, signal) as AsyncGenerator<ChatSseEvent>,
});

const CID_KEY = 'compass-ai-cid';

export default function AssistantBubble({ session }: { session: SessionInfo | null }) {
  const [open, setOpen] = useState(false);
  if (!session?.username) return null;   // 权限隔离:游客一律不见
  return open ? <ChatPanel onClose={() => setOpen(false)} /> : <BubbleButton onOpen={() => setOpen(true)} />;
}

function BubbleButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title="AI 助手"
      className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full
                 bg-accent text-white shadow-card transition hover:bg-accent-strong"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a7 7 0 0 1 7 7v3l2 3-4 1a7 7 0 0 1-10 0l-4-1 2-3V9a7 7 0 0 1 7-7z" />
        <circle cx="9.5" cy="10" r="1" fill="currentColor" /><circle cx="14.5" cy="10" r="1" fill="currentColor" />
      </svg>
    </button>
  );
}

function ChatPanel({ onClose }: { onClose: () => void }) {
  const snap = useSyncExternalStore(machine.subscribe, machine.snapshot);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // 打开即续接最近会话(spec:单会话模式,不放会话列表)
  useEffect(() => {
    if (machine.snapshot().conversationId != null) return;
    const lastCid = Number(localStorage.getItem(CID_KEY) ?? 0);
    api.aiConversations().then(async (res) => {
      const list = res.data;
      const target = list.find(c => c.id === lastCid) ?? list[0];
      if (target) await machine.open(target.id);
      else await machine.open(null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (snap.conversationId) localStorage.setItem(CID_KEY, String(snap.conversationId));
  }, [snap.conversationId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [snap.items.length]);

  const send = async () => {
    const text = input.trim();
    if (!text || snap.streaming) return;
    setInput('');
    await machine.send(text);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[560px] w-[380px] max-w-[calc(100vw-2rem)] flex-col
                    overflow-hidden rounded-card border border-border bg-card shadow-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium text-fg">AI 助手</span>
        <button className="text-faint hover:text-fg" onClick={onClose}>✕</button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {!snap.items.length && (
          <p className="px-2 py-8 text-center text-xs text-faint">
            可以问我站内有什么、帮我搜链接、增删改书签(写操作会请你确认)。
          </p>
        )}
        {snap.items.map((item, i) => <Item key={i} item={item} />)}
        {snap.error && <p className="rounded-input border border-destructive/40 px-3 py-2 text-xs text-destructive">{snap.error}</p>}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-border p-3">
        <textarea
          className="max-h-24 min-h-9 flex-1 resize-none rounded-input border border-border bg-input px-3 py-1.5
                     text-sm text-fg outline-none focus:border-accent"
          rows={1}
          value={input}
          placeholder="输入消息…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        {snap.streaming
          ? <button className="rounded-input border border-border px-3 py-1.5 text-xs text-fg" onClick={() => machine.abort()}>停止</button>
          : <button className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong" onClick={send}>发送</button>}
      </div>
    </div>
  );
}

function Item({ item }: { item: UiItem }) {
  if (item.kind === 'user') {
    return <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl bg-accent px-3.5 py-2 text-sm text-white whitespace-pre-wrap">{item.text}</div>
    </div>;
  }
  if (item.kind === 'assistant') {
    return <div className="space-y-1.5">
      {item.reasoning && <details className="rounded-lg border border-dashed border-border px-2.5 py-1.5">
        <summary className="cursor-pointer text-xs text-faint">思考过程</summary>
        <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-faint">{item.reasoning}</pre>
      </details>}
      {(item.text || item.streaming) && (
        <div className="max-w-[85%] rounded-2xl bg-input px-3.5 py-2 text-sm text-fg whitespace-pre-wrap">
          {item.text || '…'}
        </div>
      )}
    </div>;
  }
  // tool:pending = 写操作确认卡;其余为执行卡
  const badge = { running: '执行中', ok: '完成', error: '失败', rejected: '已取消', pending: '待确认' }[item.status];
  return (
    <div className={'max-w-[85%] rounded-xl border px-3 py-2 text-xs ' +
      (item.status === 'pending' ? 'border-amber-500/60 bg-amber-500/5' : 'border-border')}>
      <div className="flex items-center gap-2">
        <span className="font-medium text-fg">{item.name}</span>
        <span className="text-faint">{badge}</span>
      </div>
      {item.summary && <p className="mt-1 text-faint">{item.summary}</p>}
      {item.status === 'pending' && item.messageId != null && (
        <div className="mt-2 flex gap-2">
          <button className="rounded-input bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-strong"
            onClick={() => void machine.confirm(item.messageId!, 'approve')}>确认执行</button>
          <button className="rounded-input border border-border px-3 py-1 text-xs text-fg"
            onClick={() => void machine.confirm(item.messageId!, 'reject')}>取消</button>
        </div>
      )}
    </div>
  );
}
```

(若 compass 的 tailwind 配置无 `h-13/w-13`、`bg-input`、`text-destructive` 等 token,按 `themes/compass/tailwind.config` 实际有的 token 就近替换——原则:只用 compass 既有 token,不新增。)

- [x] **Step 2: App.tsx 挂载**

`themes/compass/src/App.tsx`:import 区补 `import AssistantBubble from './components/AssistantBubble';`,JSX 最外层 `<div className="min-h-screen">` 的末尾(Footer 区块之后、闭合 div 之前)加:

```tsx
      <AssistantBubble session={session} />
```

- [x] **Step 3: 构建 + 全仓构建验证**

Run: `pnpm --filter @navbook/theme-compass build && pnpm build`
Expected: 成功(aggregate.mjs 自检通过)

- [x] **Step 4: 手动验证**

`pnpm --filter @navbook/workers dev` 起本地,浏览器开 `http://localhost:8787/`:
- 未登录:右下角**无**气泡;
- 登录后回到主页:气泡出现 → 点开 → 续接最近会话 → 发消息 → 流式回答、思考折叠、写操作确认卡可用;
- 主题页确认的写操作,在管理端链接页能看到数据变化(同一 D1)。

- [x] **Step 5: 提交**

```bash
git add themes/compass/src
git commit -m "feat(compass): 右下角 AI 助手气泡(仅登录态,单会话续接,写操作确认卡)"
```

### Task 16: 收尾验证与部署

- [x] **Step 1: 全量测试与构建**

```bash
pnpm --filter @navbook/workers test
pnpm --filter @navbook/workers typecheck
pnpm --filter @navbook/shared test
pnpm --filter web build
pnpm build
```

Expected: 全绿(四包构建聚合到 workers/dist,aggregate 自检通过)

- [x] **Step 2: 迁移应用到生产 D1 + 部署**(需用户确认后执行)

```bash
pnpm --filter @navbook/workers db:migrate:remote   # on_ai_conversations/on_ai_messages 两表
pnpm --filter @navbook/workers deploy
```

- [x] **Step 3: 生产验证清单**

- https://nav.wenonly.cn/admin → AI 助手/模型配置 菜单可见
- 配置真实厂商 key → 聊天一轮(含一次搜索工具调用)→ 会话列表出标题
- 主题页(当前 compass)登录态见气泡,游客无
- 写操作确认/取消各走一遍,核对链接管理页数据
- 隐私模式开关切换后,游客两态均无入口(助手可见性只随登录态)

- [x] **Step 4: 提交剩余变更**(如有)

```bash
git status   # 确认无遗漏文件
```

---

## 计划自审记录(writing-plans Self-Review)

1. **Spec 覆盖**:spec §3-9 逐项对应 Task 1(config)/4(表)/9(端点+SSE 协议)/7+12(11 工具)/8+13(ReAct+确认+防御)/10+11+15(双入口+思考块)/§10 权限(全部端点 authMiddleware+气泡 session 门)/§11 错误处理(ProviderError 分类/工具自愈/abort 恢复)/§12 测试(每任务 TDD)。spec §4 `toolCallFixes` 字段为预留,计划未实现传参——已收敛为"预设即修正,后续按需",与 spec「预留」语义一致。
2. **占位符扫描**:无 TBD/TODO;两处"执行者按实际渲染二选一"(PageHeader 简化、compass token 就近替换)是显式的现场判断指令,附了判断标准,非含糊。
3. **类型一致性**:`ChatSseEvent`/`ChatMsgContent` workers 与 shared 镜像(Task 1 与 Task 5 同构,注释互指);`AiTool.execute(db,args)` 在 Task 7/12 一致;`machine.confirm(messageId, action)` 与 Task 11/15 调用一致;`TURN_TIMEOUT_MS` Task 9 import 自 Task 8 导出。

