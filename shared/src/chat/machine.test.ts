import { describe, it, expect } from 'vitest';
import { ChatMachine, blockedReason, activityLabel } from './machine';
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

describe('串行阻塞与活动状态(loading UX)', () => {
  it('pending 确认卡存在时 send 被阻塞(transport 不被调用)', async () => {
    const t = fakeTransport([
      [{ type: 'tool_call', id: 'c1', name: 'delete_link', args: {}, danger: 'write' },
       { type: 'confirm_required', messageId: 5, id: 'c1', name: 'delete_link', args: {}, summary: 's' },
       { type: 'done', messageIds: [] }],
    ]);
    const m = new ChatMachine(t as any);
    await m.send('删');
    await flush();
    const callsBefore = t.log.length;
    await m.send('趁确认卡挂着发新消息');
    await flush();
    expect(t.log.length).toBe(callsBefore);   // 未发起流
  });

  it('blockedReason:streaming / pending / null 三态', async () => {
    const t = fakeTransport([[{ type: 'delta', text: 'a' }, { type: 'done', messageIds: [] }]]);
    const m = new ChatMachine(t as any);
    expect(blockedReason(m.snapshot())).toBeNull();
    const p = m.send('hi');
    expect(blockedReason(m.snapshot())).toContain('正在处理');
    await p; await flush();
    expect(blockedReason(m.snapshot())).toBeNull();

    const t2 = fakeTransport([
      [{ type: 'tool_call', id: 'c1', name: 'delete_link', args: {}, danger: 'write' },
       { type: 'confirm_required', messageId: 9, id: 'c1', name: 'delete_link', args: {}, summary: 's' },
       { type: 'done', messageIds: [] }],
    ]);
    const m2 = new ChatMachine(t2 as any);
    await m2.send('x'); await flush();
    expect(blockedReason(m2.snapshot())).toContain('待执行操作');
  });

  it('activityLabel:思考中 → 调用工具 → 生成回复', async () => {
    const t = fakeTransport([]);
    const m = new ChatMachine(t as any);
    expect(activityLabel(m.snapshot())).toBe('');   // 非 streaming 为空
    const base = { conversationId: null, error: null } as const;
    expect(activityLabel({ ...base, streaming: true, items: [] })).toBe('正在思考…');
    expect(activityLabel({
      ...base, streaming: true,
      items: [{ kind: 'tool', id: 'a', name: 'fetch_url', args: {}, danger: 'read', status: 'running', summary: '' }],
    })).toBe('正在调用 fetch_url…');
    expect(activityLabel({
      ...base, streaming: true,
      items: [{ kind: 'assistant', id: null, text: '生成中', reasoning: '', streaming: true }],
    })).toBe('正在生成回复…');
  });

  it('tool_call(read)打 startedAt 时间戳;write 不打(pending 无需计时)', async () => {
    const t = fakeTransport([
      [{ type: 'tool_call', id: 'r1', name: 'fetch_url', args: {}, danger: 'read' }, { type: 'done', messageIds: [] }],
    ]);
    const m = new ChatMachine(t as any);
    await m.send('抓'); await flush();
    const read = m.snapshot().items.find(i => i.kind === 'tool') as any;
    expect(typeof read.startedAt).toBe('number');

    const t2 = fakeTransport([
      [{ type: 'tool_call', id: 'w1', name: 'delete_link', args: {}, danger: 'write' },
       { type: 'confirm_required', messageId: 1, id: 'w1', name: 'delete_link', args: {}, summary: '' },
       { type: 'done', messageIds: [] }],
    ]);
    const m2 = new ChatMachine(t2 as any);
    await m2.send('删'); await flush();
    const write = m2.snapshot().items.find(i => i.kind === 'tool') as any;
    expect(write.startedAt).toBeUndefined();
  });
});

describe('工具卡交错嵌聊天流(多步 ReAct 直播流)', () => {
  it('delta → 工具卡 → 新 delta:第二步文本开新气泡,工具卡夹在中间而非堆到末尾', async () => {
    const t = fakeTransport([[
      { type: 'conversation', cid: 1, title: '' },
      { type: 'delta', text: '我先搜一下' },
      { type: 'tool_call', id: 'c1', name: 'search_links', args: {}, danger: 'read' },
      { type: 'tool_result', id: 'c1', name: 'search_links', ok: true, summary: '3 条', data: { code: 0 } },
      { type: 'delta', text: '找到了 3 条' },
      { type: 'tool_call', id: 'c2', name: 'fetch_url', args: {}, danger: 'read' },
      { type: 'tool_result', id: 'c2', name: 'fetch_url', ok: true, summary: 's', data: { code: 0 } },
      { type: 'delta', text: ',总结如下' },
      { type: 'done', messageIds: [] },
    ]]);
    const m = new ChatMachine(t as any);
    await m.send('搜一下'); await flush();
    const items = m.snapshot().items;
    expect(items.map(i => i.kind)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);
    expect((items[1] as any).text).toBe('我先搜一下');
    expect((items[3] as any).text).toBe('找到了 3 条');
    expect((items[5] as any).text).toBe(',总结如下');
    expect(items.filter(i => i.kind === 'assistant').every(a => !(a as any).streaming)).toBe(true);
  });

  it('reasoning 同样遵守步边界:工具卡后的思考开新气泡', async () => {
    const t = fakeTransport([[
      { type: 'delta', text: '查' },
      { type: 'tool_call', id: 'c1', name: 'f', args: {}, danger: 'read' },
      { type: 'tool_result', id: 'c1', name: 'f', ok: true, summary: '', data: null },
      { type: 'reasoning', text: '再想想' },
      { type: 'delta', text: '结论' },
      { type: 'done', messageIds: [] },
    ]]);
    const m = new ChatMachine(t as any);
    await m.send('go'); await flush();
    const items = m.snapshot().items;
    expect(items.map(i => i.kind)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect((items[3] as any).reasoning).toBe('再想想');
  });

  it('刷新回放:历史行序天然交错,与直播流形态一致(反向解析)', async () => {
    const dto: ChatMessageDto[] = [
      { id: 1, role: 'user', content: { text: '查' }, created_at: 1 },
      { id: 2, role: 'assistant', content: { text: '搜一下', reasoning: '', toolCalls: [{ id: 'c1', name: 'search_links', args: {} }] }, created_at: 2 },
      { id: 3, role: 'tool', content: { toolCallId: 'c1', name: 'search_links', args: {}, status: 'ok', summary: '3 条', result: { code: 0 } }, created_at: 3 },
      { id: 4, role: 'assistant', content: { text: '找到 3 条', reasoning: '', toolCalls: [] }, created_at: 4 },
    ];
    const m = new ChatMachine({ stream: async function* () {}, history: async () => dto } as any);
    await m.open(9);
    expect(m.snapshot().items.map(i => i.kind)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });
});

describe('重挂续流(DO 后台回合)', () => {
  function attachableTransport(script: ChatSseEvent[][], historyDtos: ChatMessageDto[] = []) {
    let call = 0;
    return {
      stream: async function* (): AsyncGenerator<ChatSseEvent> {
        yield* script[call++] ?? [{ type: 'done', messageIds: [] }];
      },
      history: async () => historyDtos,
      attach: async function* (cid: number): AsyncGenerator<ChatSseEvent> {
        void cid;
        yield* script[call++] ?? [{ type: 'done', messageIds: [] }];
      },
    };
  }

  it('open:running 会话跳过 live 行并重挂(hello→重放→done 与直播同形态)', async () => {
    const history: ChatMessageDto[] = [
      { id: 1, role: 'user', content: { text: '查' }, created_at: 1 },
      { id: 2, role: 'assistant', content: { text: '半截', reasoning: '', toolCalls: [], live: true }, created_at: 2 },   // live 行→跳过
    ];
    const t = attachableTransport([[
      { type: 'hello', running: true },
      { type: 'delta', text: '半截' },        // 回放:从回合前状态重放,半截由事件流重建
      { type: 'delta', text: '续写完成' },
      { type: 'done', messageIds: [] },
    ]], history);
    const m = new ChatMachine(t as any);
    await m.open(7); await flush();
    expect(m.snapshot().conversationId).toBe(7);
    const items = m.snapshot().items;
    expect(items.map(i => i.kind)).toEqual(['user', 'assistant']);   // live 行未重复
    expect((items[1] as any).text).toBe('半截续写完成');
    expect(m.snapshot().streaming).toBe(false);
  });

  it('open:非 running 会话 hello 后即收,不加气泡', async () => {
    const t = attachableTransport([[{ type: 'hello', running: false }, { type: 'done', messageIds: [] }]]);
    const m = new ChatMachine(t as any);
    await m.open(3); await flush();
    expect(m.snapshot().items).toEqual([]);
    expect(m.snapshot().streaming).toBe(false);
  });

  it('open:error 行映射为 error 红条', async () => {
    const history: ChatMessageDto[] = [
      { id: 1, role: 'user', content: { text: 'hi' }, created_at: 1 },
      { id: 2, role: 'error', content: { text: '厂商接口错误' }, created_at: 2 },
    ];
    const m = new ChatMachine({ stream: async function* () {}, history: async () => history } as any);
    await m.open(5);
    expect(m.snapshot().items[1]).toEqual({ kind: 'error', text: '厂商接口错误' });
  });
});

describe('确认卡 loading 与防重复点击(confirmingToolId)', () => {
  /** 第一轮(send)即出确认卡;第二轮(confirm)被门控直到 release */
  function gatedConfirmTransport(gate: Promise<void>, log: ChatStreamBody[]) {
    let call = 0;
    return {
      log,
      async *stream(body: ChatStreamBody): AsyncGenerator<ChatSseEvent> {
        log.push(body);
        if (call++ === 0) {
          yield { type: 'tool_call', id: 'c1', name: 'delete_link', args: {}, danger: 'write' } as ChatSseEvent;
          yield { type: 'confirm_required', messageId: 9, id: 'c1', name: 'delete_link', args: {}, summary: 's' } as ChatSseEvent;
          yield { type: 'done', messageIds: [] } as ChatSseEvent;
        } else {
          await gate;
          yield { type: 'tool_result', id: 'c1', name: 'delete_link', ok: true, summary: 'done', data: null } as ChatSseEvent;
          yield { type: 'done', messageIds: [] } as ChatSseEvent;
        }
      },
      async history(_cid: number): Promise<ChatMessageDto[]> { return []; },
    };
  }

  it('confirm 期间 confirmingToolId=该卡;二次点击被吞;done 后清零', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const log: ChatStreamBody[] = [];
    const m = new ChatMachine(gatedConfirmTransport(gate, log) as any);
    await m.send('删'); await flush();
    expect(m.snapshot().confirmingToolId).toBeNull();

    const p = m.confirm(9, 'approve', 'c1');
    await flush();
    expect(m.snapshot().confirmingToolId).toBe('c1');     // 卡级 loading 可见
    // 期间重复点击(确认/取消)全部被吞
    await m.confirm(9, 'approve', 'c1');
    await m.confirm(9, 'reject', 'c1');
    expect(log.length).toBe(2);                            // 只有 send + 第一次 confirm
    release();
    await p; await flush();
    expect(m.snapshot().confirmingToolId).toBeNull();      // done 后清零
    expect(m.snapshot().streaming).toBe(false);
  });

  it('abort 清 confirmingToolId(停止按钮)', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const m = new ChatMachine(gatedConfirmTransport(gate, []) as any);
    await m.send('删'); await flush();
    void m.confirm(2, 'approve', 'c1');
    await flush();
    expect(m.snapshot().confirmingToolId).toBe('c1');
    m.abort();
    expect(m.snapshot().confirmingToolId).toBeNull();
    release();
    await flush();
  });
});
