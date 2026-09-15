import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { AiConfig, AiPreset, AiProviderConfig, WorkerDB } from './types';

const KEY = 's_ai';

export const AI_PRESETS: AiPreset[] = [
  { id: 'deepseek',   name: 'DeepSeek',            baseUrl: 'https://api.deepseek.com/v1',                             models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'qwen',       name: '通义千问',             baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',       models: ['qwen-plus', 'qwen-max'] },
  { id: 'moonshot',   name: 'Kimi',                baseUrl: 'https://api.moonshot.cn/v1',                              models: ['kimi-latest'] },
  { id: 'zhipu',      name: '智谱',                 baseUrl: 'https://open.bigmodel.cn/api/paas/v4',                    models: ['glm-4.6', 'glm-4-flash'] },
  { id: 'doubao',     name: '豆包',                 baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',                models: [] },
  { id: 'openai',     name: 'OpenAI',              baseUrl: 'https://api.openai.com/v1',                              models: ['gpt-5', 'gpt-5-mini'] },
  { id: 'anthropic',  name: 'Anthropic(兼容端点)', baseUrl: 'https://api.anthropic.com/v1',                           models: ['claude-sonnet-5'] },
  { id: 'gemini',     name: 'Gemini(兼容端点)',    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-pro'] },
  { id: 'custom',     name: '自定义',               baseUrl: '',                                                       models: [] },
];

export const DEFAULT_AI_CONFIG: AiConfig = { providers: [], activeProviderId: null, systemPrompt: '' };

export async function loadAiConfig(db: WorkerDB): Promise<AiConfig> {
  const row = await db.select().from(schema.options).where(eq(schema.options.key, KEY)).get();
  if (!row?.value) return { ...DEFAULT_AI_CONFIG };
  try {
    const p = JSON.parse(row.value);
    return {
      // enabled 字段已废弃(与 activeProviderId 单选语义冗余);存量值读取时剥离
      providers: Array.isArray(p?.providers)
        ? p.providers.map(({ enabled: _legacy, ...rest }: any) => rest)
        : [],
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

/** apiKey → `sk-***` + 尾4位(不足8位全打码) */
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

/** 激活厂商必须存在,否则 null(调用方给出"请到模型配置"引导) */
export function resolveActiveProvider(cfg: AiConfig): AiProviderConfig | null {
  return cfg.providers.find(x => x.id === cfg.activeProviderId) ?? null;
}
