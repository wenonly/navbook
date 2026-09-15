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
