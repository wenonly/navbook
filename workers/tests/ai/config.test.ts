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
    model: 'deepseek-chat',
  }],
  activeProviderId: 'p1',
  systemPrompt: '',
  mcpServers: [],
  toolPolicy: {},
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

  it('resolveActiveProvider:取激活厂商;activeProviderId 悬空 → null', async () => {
    await saveAiConfig(db(), full);
    const got = resolveActiveProvider(await loadAiConfig(db()))!;
    expect(got.id).toBe('p1');
    expect(resolveActiveProvider({ ...full, activeProviderId: 'nope' })).toBeNull();
    expect(resolveActiveProvider(DEFAULT_AI_CONFIG)).toBeNull();
  });

  it('存量 enabled 字段读取时剥离(字段已废弃)', async () => {
    await saveAiConfig(db(), { ...full, providers: [{ ...full.providers[0], enabled: true } as any] });
    const loaded = await loadAiConfig(db());
    expect(loaded).toEqual(full);   // enabled 不再出现
  });

  it('预设表含关键厂商且自定义项存在', () => {
    const ids = AI_PRESETS.map(p => p.id);
    for (const need of ['deepseek', 'qwen', 'openai', 'custom']) expect(ids).toContain(need);
    expect(AI_PRESETS.find(p => p.id === 'custom')!.baseUrl).toBe('');
  });
});

describe('ai config mcpServers', () => {
  const withMcp = {
    ...full,
    mcpServers: [
      { id: 'm1', name: 'Tavily', url: 'https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-x', apiKey: '', trust: 'auto' as const },
      { id: 'm2', name: '智谱', url: 'https://mcp.bigmodel.cn/mcp', apiKey: 'bearer-secret-8888', trust: 'confirm' as const },
    ],
  };

  it('保存后可读回', async () => {
    await saveAiConfig(db(), withMcp);
    expect(await loadAiConfig(db())).toEqual(withMcp);
  });

  it('maskConfig:mcp apiKey 打码,空串保持空串(maskKey("") 坑回归)', () => {
    const masked = maskConfig(withMcp);
    expect(masked.mcpServers![0].apiKey).toBe('');            // key 拼 URL 的服务器:空串必须原样
    expect(masked.mcpServers![1].apiKey).toBe('sk-***8888');  // Bearer 场景照常打码
  });

  it('mergeMaskedKeys:mcp 打码占位沿用原值,真新值覆盖,删除条目生效', async () => {
    await saveAiConfig(db(), withMcp);
    const existing = await loadAiConfig(db());
    const incoming = {
      ...withMcp,
      mcpServers: [
        { ...withMcp.mcpServers[0] },
        { ...withMcp.mcpServers[1], apiKey: 'sk-***8888' },   // 占位 → 沿用 bearer-secret-8888
        { id: 'm3', name: '新', url: 'https://n.example.com', apiKey: 'sk-real-9999', trust: 'confirm' as const },
      ],
    };
    const merged = mergeMaskedKeys(existing, incoming);
    expect(merged.mcpServers![1].apiKey).toBe('bearer-secret-8888');
    expect(merged.mcpServers![2].apiKey).toBe('sk-real-9999');
    // 删除条目:incoming 去掉 m1 后合并结果不含 m1
    const removed = mergeMaskedKeys(existing, { ...withMcp, mcpServers: [incoming.mcpServers[1]] });
    expect(removed.mcpServers!.map(s => s.id)).toEqual(['m2']);
  });

  it('loadAiConfig 兜底:畸形条目过滤、>5 截断、trust 非法回落 confirm、apiKey 非串回落空串', async () => {
    await env.DB.prepare(
      "INSERT INTO on_options (key, value) VALUES ('s_ai', ?)"
    ).bind(JSON.stringify({
      providers: [],
      activeProviderId: null,
      systemPrompt: '',
      mcpServers: [
        { id: 'ok', name: 'A', url: 'https://a.example.com', apiKey: 123, trust: 'weird' },  // apiKey 非串/trust 非法
        { id: '', name: 'X', url: 'https://x.example.com' },                                  // 缺 id → 丢弃
        { no: 'shape' },                                                                        // 畸形 → 丢弃
        ...Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, name: `E${i}`, url: `https://e${i}.example.com` })),  // 8 条合法 → 截 5
      ],
    })).run();
    const loaded = await loadAiConfig(db());
    expect(loaded.mcpServers).toHaveLength(5);
    expect(loaded.mcpServers[0]).toEqual({ id: 'ok', name: 'A', url: 'https://a.example.com', apiKey: '', trust: 'confirm' });
  });
});

describe('ai config toolPolicy(确认口子)', () => {
  it('保存后可读回;非法值过滤;存量缺省回落 {}', async () => {
    const cfg = { ...full, toolPolicy: { fetch_url: 'confirm' as const, search_links: 'auto' as const } };
    await saveAiConfig(db(), cfg);
    expect((await loadAiConfig(db())).toolPolicy).toEqual({ fetch_url: 'confirm', search_links: 'auto' });

    // 非法值直接写库(绕过校验)→ 读取时过滤
    await env.DB.prepare("UPDATE on_options SET value=? WHERE key='s_ai'").bind(JSON.stringify({
      ...cfg, toolPolicy: { fetch_url: 'confirm', bad: 'weird', '': 'auto' },
    })).run();
    expect((await loadAiConfig(db())).toolPolicy).toEqual({ fetch_url: 'confirm' });

    // 缺省
    expect((await loadAiConfig(db())).toolPolicy).toBeDefined();
    await saveAiConfig(db(), { ...full });
    expect((await loadAiConfig(db())).toolPolicy).toEqual({});
  });
});
