import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { resetTables } from '../helpers';
import { addCategoryHandler } from '../../src/handlers/category';
import { addLinkHandler } from '../../src/handlers/link';
import { runAgentTurn } from '../../src/ai/agent';
import type { AiConfig, ProviderClient, ProviderStreamEvent, ProviderMessage, ChatSseEvent } from '../../src/ai/types';

beforeEach(async () => { await resetTables(); });
const db = () => getDb(env.DB);
// Fake 场景也要有"激活厂商",否则 runAgentTurn 在 resolveActiveProvider 处 fail-fast
const ACTIVE = {
  id: 'p1', name: 'X', preset: 'custom',
  baseUrl: 'https://fake/v1', apiKey: 'sk-x', model: 'm', enabled: true,
};
const EMPTY_CFG = { providers: [ACTIVE], activeProviderId: 'p1', systemPrompt: '' };
const NO_PROVIDER_CFG = { providers: [], activeProviderId: null, systemPrompt: '' };

/** 脚本化厂商:每次 streamChat 弹出一段事件序列 */
class FakeProvider implements ProviderClient {
  turns: ProviderStreamEvent[][];
  calls: ProviderMessage[][] = [];
  constructor(turns: ProviderStreamEvent[][]) { this.turns = turns; }
  async *streamChat(p: { messages: ProviderMessage[] }): AsyncGenerator<ProviderStreamEvent> {
    this.calls.push(p.messages);
    const turn = this.turns.shift() ?? [{ type: 'finish', reason: 'stop' } as ProviderStreamEvent];
    yield* turn;
  }
}

async function collectEvents(
  provider: FakeProvider,
  opts: Partial<Parameters<typeof runAgentTurn>[2]> & { conversationId?: number; cfg?: AiConfig },
) {
  const events: ChatSseEvent[] = [];
  const { createConversation } = await import('../../src/ai/conversations');
  const cid = opts.conversationId ?? (await createConversation(db(), 't')).id;
  await runAgentTurn({ db: db(), provider }, opts.cfg ?? EMPTY_CFG, {
    ...opts,
    conversationId: cid,
    emit: async e => { events.push(e); },
  } as Parameters<typeof runAgentTurn>[2]);
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
    const loops = Array.from({ length: 20 }, () => [
      { type: 'tool_call', call: { id: 'c', name: 'list_categories', args: '{}' } },
      { type: 'finish', reason: 'tool_calls' },
    ] as ProviderStreamEvent[]);
    const provider = new FakeProvider(loops);
    const events = await collectEvents(provider, { message: 'hi' });
    expect(events.some(e => e.type === 'error' && e.msg.includes('8'))).toBe(true);
  });

  it('未配置厂商 → error 事件引导去配置页', async () => {
    const events = await collectEvents(new FakeProvider([]), { message: 'hi', cfg: NO_PROVIDER_CFG });
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
