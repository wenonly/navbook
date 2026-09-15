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

describe('runAgentTurn(写工具确认流)', () => {
  it('写工具 → confirm_required(不执行),pending 消息落库', async () => {
    const provider = new FakeProvider([[
      { type: 'tool_call', call: { id: 'c1', name: 'delete_link', args: '{"id":1}' } },
      { type: 'finish', reason: 'tool_calls' },
    ]]);
    const { createConversation } = await import('../../src/ai/conversations');
    const conv = await createConversation(db(), 't');
    const events = await collectEvents(provider, { message: '删掉链接1', conversationId: conv.id });
    const cf = events.find(e => e.type === 'confirm_required') as any;
    expect(cf).toBeTruthy();
    expect(cf.name).toBe('delete_link');
    expect(cf.summary).toContain('删除链接 #1');
    // 库里是 pending(未执行任何写)
    const msgs = await (await import('../../src/ai/conversations')).listMessages(db(), conv.id);
    const toolMsg = msgs.find(m => m.role === 'tool')!;
    expect((toolMsg.content as any).status).toBe('pending');
  });

  it('approve:执行工具 → tool_result → 循环继续到最终回答', async () => {
    const cat = await addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    const link = await addLinkHandler(db(), { fid: cat.id, title: 'GitHub', url: 'https://github.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
    const provider = new FakeProvider([[
      { type: 'tool_call', call: { id: 'c1', name: 'delete_link', args: JSON.stringify({ id: link.id }) } },
      { type: 'finish', reason: 'tool_calls' },
    ]]);
    const { createConversation } = await import('../../src/ai/conversations');
    const conv = await createConversation(db(), 't');
    const events = await collectEvents(provider, { message: '删掉那条链接', conversationId: conv.id });
    const cf = events.find(e => e.type === 'confirm_required') as any;

    // 确认:新一轮(provider 提供最终回答)
    provider.turns.push([{ type: 'text', delta: '已删除' }, { type: 'finish', reason: 'stop' }]);
    const events2 = await collectEvents(provider, { conversationId: conv.id, confirm: { messageId: cf.messageId, action: 'approve' } });
    const tr = events2.find(e => e.type === 'tool_result') as any;
    expect(tr.ok).toBe(true);
    expect(events2.some(e => e.type === 'delta')).toBe(true);
    // 链接真的没了
    const { getALinkHandler } = await import('../../src/handlers/link');
    expect((await getALinkHandler(db(), link.id, true) as any).code).not.toBe(0);
  });

  it('approve 续跑:带 tool_calls 的 assistant 历史必须回传 reasoning_content(DeepSeek 思考模式 400 回归)', async () => {
    const provider = new FakeProvider([[
      { type: 'reasoning', delta: '用户要删除,先确认目标' },
      { type: 'tool_call', call: { id: 'c1', name: 'delete_link', args: '{"id":1}' } },
      { type: 'finish', reason: 'tool_calls' },
    ]]);
    const { createConversation } = await import('../../src/ai/conversations');
    const conv = await createConversation(db(), 't');
    const events = await collectEvents(provider, { message: '删掉链接1', conversationId: conv.id });
    const cf = events.find(e => e.type === 'confirm_required') as any;

    provider.turns.push([{ type: 'text', delta: '已处理' }, { type: 'finish', reason: 'stop' }]);
    await collectEvents(provider, { conversationId: conv.id, confirm: { messageId: cf.messageId, action: 'approve' } });
    const msgs = provider.calls.at(-1)!;
    const asst = msgs.find(m => m.role === 'assistant' && m.tool_calls);
    expect(asst?.reasoning_content).toBe('用户要删除,先确认目标');
  });

  it('reject:pending → rejected,模型收到拒绝并继续对话', async () => {
    const provider = new FakeProvider([[
      { type: 'tool_call', call: { id: 'c1', name: 'delete_link', args: '{"id":1}' } },
      { type: 'finish', reason: 'tool_calls' },
    ]]);
    const { createConversation } = await import('../../src/ai/conversations');
    const conv = await createConversation(db(), 't');
    const events = await collectEvents(provider, { message: '删掉链接1', conversationId: conv.id });
    const cf = events.find(e => e.type === 'confirm_required') as any;

    provider.turns.push([{ type: 'text', delta: '好的,不删了' }, { type: 'finish', reason: 'stop' }]);
    const events2 = await collectEvents(provider, { conversationId: conv.id, confirm: { messageId: cf.messageId, action: 'reject' } });
    const tr = events2.find(e => e.type === 'tool_result') as any;
    expect(tr.ok).toBe(false);
    expect(tr.summary).toContain('取消');
    // 模型侧第二轮上下文里有 rejected 结果
    const toolMsg = provider.calls.at(-1)!.find(m => m.role === 'tool');
    expect(toolMsg?.content).toContain('rejected');
  });

  it('batch_write → 单张 confirm_required(多行清单),approve 后逐项执行并续跑', async () => {
    const cat = await addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    const link = await addLinkHandler(db(), { fid: cat.id, title: 'GitHub', url: 'https://github.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
    const provider = new FakeProvider([[
      { type: 'tool_call', call: { id: 'b1', name: 'batch_write', args: JSON.stringify({ operations: [
        { action: 'update_link', args: { id: link.id, description: '批量改' } },
        { action: 'delete_link', args: { id: link.id } },
        { action: 'create_category', args: { name: '批量分类' } },
      ] }) } },
      { type: 'finish', reason: 'tool_calls' },
    ]]);
    const { createConversation } = await import('../../src/ai/conversations');
    const conv = await createConversation(db(), 't');
    const events = await collectEvents(provider, { message: '清理一下', conversationId: conv.id });
    // 恰好一张确认卡,summary 为编号多行清单
    const cards = events.filter(e => e.type === 'confirm_required');
    expect(cards).toHaveLength(1);
    const cf = cards[0] as any;
    expect(cf.name).toBe('batch_write');
    expect(cf.summary).toContain('\n');
    expect(cf.summary).toContain('修改链接');
    expect(cf.summary).toContain('删除链接');

    provider.turns.push([{ type: 'text', delta: '已处理完' }, { type: 'finish', reason: 'stop' }]);
    const events2 = await collectEvents(provider, { conversationId: conv.id, confirm: { messageId: cf.messageId, action: 'approve' } });
    const tr = events2.find(e => e.type === 'tool_result') as any;
    expect(tr.ok).toBe(true);
    expect(events2.some(e => e.type === 'delta')).toBe(true);
    // 逐项执行:链接已删,分类已建
    const { getALinkHandler } = await import('../../src/handlers/link');
    expect((await getALinkHandler(db(), link.id, true) as any).code).not.toBe(0);
    const toolMsg = provider.calls.at(-1)!.find(m => m.role === 'tool');
    expect(toolMsg?.content).toContain('ok_count');
  });

  it('batch_write 部分失败 approve:tool_result ok=false,失败明细喂回模型', async () => {
    const cat = await addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    const link = await addLinkHandler(db(), { fid: cat.id, title: 'GitHub', url: 'https://github.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
    const provider = new FakeProvider([[
      { type: 'tool_call', call: { id: 'b1', name: 'batch_write', args: JSON.stringify({ operations: [
        { action: 'delete_category', args: { id: cat.id } },   // 分类下有链接 → 单项失败
        { action: 'delete_link', args: { id: link.id } },
      ] }) } },
      { type: 'finish', reason: 'tool_calls' },
    ]]);
    const { createConversation } = await import('../../src/ai/conversations');
    const conv = await createConversation(db(), 't');
    const events = await collectEvents(provider, { message: '清空分类和链接', conversationId: conv.id });
    const cf = events.find(e => e.type === 'confirm_required') as any;

    provider.turns.push([{ type: 'text', delta: '部分完成' }, { type: 'finish', reason: 'stop' }]);
    const events2 = await collectEvents(provider, { conversationId: conv.id, confirm: { messageId: cf.messageId, action: 'approve' } });
    const tr = events2.find(e => e.type === 'tool_result') as any;
    expect(tr.ok).toBe(false);
    expect(tr.summary).toContain('失败');
    const toolMsg = provider.calls.at(-1)!.find(m => m.role === 'tool');
    expect(toolMsg?.content).toContain('此分类下存在链接');
  });

  it('confirm 的 messageId 不属于 pending 工具消息 → error', async () => {
    const { createConversation, insertMessage } = await import('../../src/ai/conversations');
    const conv = await createConversation(db(), 't');
    const u = await insertMessage(db(), conv.id, 'user', { text: 'x' });
    const events: ChatSseEvent[] = [];
    await runAgentTurn({ db: db(), provider: new FakeProvider([]) }, EMPTY_CFG, {
      conversationId: conv.id,
      confirm: { messageId: u.id, action: 'approve' },
      emit: async e => { events.push(e); },
    });
    expect(events.some(e => e.type === 'error')).toBe(true);
  });
});
