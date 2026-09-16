// context.ts 单测:窗口切割边界对齐与消息合法性防线(生产 400 回归的独立直测)。
import { describe, it, expect } from 'vitest';
import { assembleProviderMessages, CONTEXT_LIMIT } from '../../src/ai/context';
import type { ChatMessageDto } from '../../src/ai/conversations';

function dto(id: number, role: ChatMessageDto['role'], content: any): ChatMessageDto {
  return { id, role, content, createdAt: id };
}
const u = (id: number, text = `u${id}`) => dto(id, 'user', { text });
const a = (id: number, toolCalls: any[] = [], text = '') =>
  dto(id, 'assistant', { text, reasoning: '', toolCalls });
const t = (id: number, callId: string) =>
  dto(id, 'tool', { toolCallId: callId, name: 'x', args: {}, status: 'ok', summary: '', result: { code: 0 } });

/** 厂商视角校验:每条 role:'tool' 的前一条必须是含其 id 的 assistant(tool_calls) */
function assertValidToolSequence(msgs: Array<{ role: string; tool_call_id?: string; tool_calls?: Array<{ id: string }> }>) {
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'tool') continue;
    const prev = msgs[i - 1];
    expect(prev, `messages[${i}] (tool) 前一条不存在`).toBeDefined();
    expect(prev!.role, `messages[${i}] (tool) 前一条是 ${prev!.role}`).toBe('assistant');
    expect((prev!.tool_calls ?? []).map(c => c.id)).toContain(msgs[i].tool_call_id);
  }
}

describe('assembleProviderMessages', () => {
  it('常规映射:system 在首,user/assistant/tool 顺序保持;tool_calls/reasoning_content 正确产出', () => {
    const msgs = assembleProviderMessages(
      [u(1), a(2, [{ id: 'c1', name: 'f', args: {} }], '查'), t(3, 'c1'), a(4, [], '答')],
      'SYS',
    );
    expect(msgs[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(msgs.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant']);
    const assistant = msgs[2] as any;
    expect(assistant.tool_calls[0].id).toBe('c1');
    expect(assistant.content).toBe('查');
    assertValidToolSequence(msgs);
  });

  it('带 tool_calls 且有 reasoning 的 assistant 回传 reasoning_content(DeepSeek 思考模式要求)', () => {
    const history = [u(1), dto(2, 'assistant', { text: '', reasoning: '想了', toolCalls: [{ id: 'c1', name: 'f', args: {} }] }), t(3, 'c1')];
    const msgs = assembleProviderMessages(history, 'S');
    expect((msgs[2] as any).reasoning_content).toBe('想了');
  });

  it('窗口边界落在 tool 上 → 回扩到父 assistant(不产生孤儿 tool)', () => {
    // 51 条:u0 + 25×(a+t);边界起点恰为 t1
    const history = [u(0)];
    for (let i = 1; i <= 25; i++) {
      history.push(a(i, [{ id: `c${i}`, name: 'f', args: {} }]));
      history.push(t(100 + i, `c${i}`));
    }
    const msgs = assembleProviderMessages(history, 'S');
    expect(msgs[1].role).not.toBe('tool');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs.length).toBeLessThanOrEqual(CONTEXT_LIMIT + 3);   // 回扩允许略超
    assertValidToolSequence(msgs);
  });

  it('孤儿 tool 丢弃;应答不完整的 assistant 剥 tool_calls 降级', () => {
    const history = [
      t(1, 'c-orphan'),                                  // 孤儿(无父)
      u(2),
      a(3, [{ id: 'c9', name: 'f', args: {} }]),          // 应答缺失
      u(4),
    ];
    const msgs = assembleProviderMessages(history, 'S');
    expect(msgs.filter(m => m.role === 'tool')).toEqual([]);
    const broken = msgs.find(m => (m as any).tool_calls?.length);
    expect(broken).toBeUndefined();
    expect((msgs.find(m => m.role === 'assistant') as any).content).toContain('未完成');
    assertValidToolSequence(msgs);
  });

  it('纯 user 长历史:截最后 CONTEXT_LIMIT 条,最新消息必在', () => {
    const history = Array.from({ length: 60 }, (_, i) => u(i + 1));
    const msgs = assembleProviderMessages(history, 'S');
    expect(msgs.length).toBe(CONTEXT_LIMIT + 1);   // system + 50
    expect(msgs.at(-1)!.content).toBe('u60');
  });
});
