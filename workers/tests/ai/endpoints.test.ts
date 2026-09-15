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
    const json: any = await res.json();
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
    expect((await save.json() as any).code).toBe(0);

    const got: any = await (await authed('/api/ai_config')).json();
    expect(got.data.config.providers[0].apiKey).toBe('sk-***1234');

    // 回显打码值再保存:key 不变,model 变
    const maskedPayload = JSON.parse(JSON.stringify(payload));
    maskedPayload.providers[0].apiKey = 'sk-***1234';
    maskedPayload.providers[0].model = 'deepseek-reasoner';
    await authed('/api/ai_config', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(maskedPayload),
    });
    const got2: any = await (await authed('/api/ai_config')).json();
    expect(got2.data.config.providers[0].model).toBe('deepseek-reasoner');
    // 原值未丢:直接读库验证
    const row = await env.DB.prepare("SELECT value FROM on_options WHERE key='s_ai'").first<any>();
    expect(row.value).toContain('sk-secret-1234');
  });

  it('非法 JSON body 报业务错误', async () => {
    const res = await authed('/api/ai_config', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops',
    });
    expect((await res.json() as any).code).not.toBe(0);
  });
});
