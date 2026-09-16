// 长期记忆:读写回环 + 工具行为(超限拒绝/空串清空)+ agent 注入与默认免确认。
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { resetTables } from '../helpers';
import { loadMemory, saveMemory, MEMORY_MAX_CHARS } from '../../src/ai/memory';
import { findTool } from '../../src/ai/tools';
import { resolveExecPolicy } from '../../src/ai/batch';
import { runAgentTurn } from '../../src/ai/agent';
import type { ProviderClient, ProviderMessage, ProviderStreamEvent, ChatSseEvent } from '../../src/ai/types';
import { createConversation } from '../../src/ai/conversations';

beforeEach(async () => { await resetTables(); });
const db = () => getDb(env.DB);

class FakeProvider implements ProviderClient {
  calls: ProviderMessage[][] = [];
  constructor(private turns: ProviderStreamEvent[][]) {}
  async *streamChat(p: { messages: ProviderMessage[] }): AsyncGenerator<ProviderStreamEvent> {
    this.calls.push(p.messages);
    yield* this.turns.shift() ?? [{ type: 'finish', reason: 'stop' } as ProviderStreamEvent];
  }
}
const CFG = { providers: [{ id: 'p1', name: 'X', preset: 'custom', baseUrl: 'https://f/v1', apiKey: 'k', model: 'm' }],
  activeProviderId: 'p1', systemPrompt: '', mcpServers: [], toolPolicy: {} };

describe('memory 存取', () => {
  it('缺省空串;保存后读回;空串清空', async () => {
    expect(await loadMemory(db())).toBe('');
    await saveMemory(db(), '# 记忆\n- 偏好:简洁');
    expect(await loadMemory(db())).toBe('# 记忆\n- 偏好:简洁');
    await saveMemory(db(), '');
    expect(await loadMemory(db())).toBe('');
  });
});

describe('memory_write 工具', () => {
  it('落库并返回长度;超限返回业务错误且不落库', async () => {
    const tool = findTool('memory_write')!;
    const ok: any = await tool.execute(db(), { content: '记住:回复用中文' });
    expect(ok.code).toBe(0);
    expect(await loadMemory(db())).toBe('记住:回复用中文');

    const tooLong: any = await tool.execute(db(), { content: 'x'.repeat(MEMORY_MAX_CHARS + 1) });
    expect(tooLong.code).not.toBe(0);
    expect(tooLong.msg).toContain('压缩');
    expect(await loadMemory(db())).toBe('记住:回复用中文');   // 未被覆盖
  });

  it('defaultPolicy=auto:resolveExecPolicy 免确认;配置可覆盖回 confirm', () => {
    const tool = findTool('memory_write')!;
    expect(tool.danger).toBe('write');
    expect(resolveExecPolicy(tool, {})).toBe('auto');
    expect(resolveExecPolicy(tool, { memory_write: 'confirm' })).toBe('confirm');
  });
});

describe('agent 记忆注入与自更新', () => {
  it('非空记忆注入 system;本轮 memory_write 直接执行(无确认卡);下轮 system 已更新', async () => {
    await saveMemory(db(), '- 旧记忆:喜欢暗色');
    const conv = await createConversation(db(), 't');

    // 第一轮:模型调 memory_write 更新记忆
    const provider = new FakeProvider([
      [{ type: 'tool_call', call: { id: 'c1', name: 'memory_write', args: JSON.stringify({ content: '- 新记忆:回复保持简洁' }) } },
       { type: 'finish', reason: 'tool_calls' }],
    ]);
    const events: ChatSseEvent[] = [];
    await runAgentTurn({ db: db(), provider }, CFG, {
      conversationId: conv.id, message: '记住:回复保持简洁',
      emit: async e => { events.push(e); },
    });
    expect(events.some(e => e.type === 'confirm_required')).toBe(false);   // 默认免确认
    expect((events.find(e => e.type === 'tool_result') as any).ok).toBe(true);
    expect(await loadMemory(db())).toBe('- 新记忆:回复保持简洁');
    // system 注入了旧记忆
    expect(String(provider.calls[0][0].content)).toContain('旧记忆:喜欢暗色');
    expect(String(provider.calls[0][0].content)).toContain('## 长期记忆');

    // 第二轮:system 含新记忆
    const p2 = new FakeProvider([[{ type: 'finish', reason: 'stop' }]]);
    await runAgentTurn({ db: db(), provider: p2 }, CFG, {
      conversationId: conv.id, message: 'hi',
      emit: async () => {},
    });
    expect(String(p2.calls[0][0].content)).toContain('新记忆:回复保持简洁');
    expect(String(p2.calls[0][0].content)).not.toContain('旧记忆');
  });

  it('空记忆时不注入记忆段', async () => {
    const conv = await createConversation(db(), 't');
    const provider = new FakeProvider([[{ type: 'finish', reason: 'stop' }]]);
    await runAgentTurn({ db: db(), provider }, CFG, {
      conversationId: conv.id, message: 'hi',
      emit: async () => {},
    });
    expect(String(provider.calls[0][0].content)).not.toContain('## 长期记忆');
  });
});
