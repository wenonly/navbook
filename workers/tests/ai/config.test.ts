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
