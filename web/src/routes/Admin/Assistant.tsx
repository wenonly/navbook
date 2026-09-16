import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChatMachine, parseSseStream, blockedReason } from '@navbook/shared';
import type { ChatMessageDto, ChatSseEvent, ConversationDto } from '@navbook/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ChatMessages } from '@/components/assistant/ChatMessages';
import { Plus, Send, Square, Trash2, PanelLeftClose, PanelLeft } from 'lucide-react';

/** web 侧传输层:普通端点走 api client,SSE 走 shared 解析器(同源 cookie 自动携带) */
const machine = new ChatMachine({
  history: async (cid: number): Promise<ChatMessageDto[]> =>
    (await api.aiMessages(cid)).data,
  stream: async function* (body, signal) {
    const fd = new FormData();
    fd.append('cid', String(body.cid));
    if (body.message !== undefined) fd.append('message', body.message);
    if (body.confirm) {
      fd.append('confirm_message_id', String(body.confirm.message_id));
      fd.append('confirm_action', body.confirm.action);
    }
    const res = await fetch('/api/ai_chat', { method: 'POST', body: fd, signal });
    if (res.status === 401) { location.href = '/admin/login'; throw new Error('未登录'); }
    if (!res.ok || !res.body) throw new Error(`AI 服务异常(HTTP ${res.status})`);
    for await (const { event, data } of parseSseStream(res.body)) {
      if (event === 'hb') continue;
      yield JSON.parse(data) as ChatSseEvent;
    }
  },
});

export function AdminAssistant() {
  const qc = useQueryClient();
  const snap = useSyncExternalStore(machine.subscribe, machine.snapshot);
  const [input, setInput] = useState('');
  const [showList, setShowList] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const conversations = useQuery({
    queryKey: ['ai-conversations'],
    queryFn: () => api.aiConversations() as Promise<{ data: ConversationDto[] }>,
  });

  // 进入页面:无选中会话时续接最近一个
  useEffect(() => {
    if (machine.snapshot().conversationId == null && conversations.data?.data.length) {
      void machine.open(conversations.data.data[0].id);
    }
  }, [conversations.data]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [snap.items.length, snap.items.at(-1)]);

  const onSend = async () => {
    const text = input.trim();
    if (!text || snap.streaming) return;
    setInput('');
    await machine.send(text);
    void qc.invalidateQueries({ queryKey: ['ai-conversations'] });
  };

  const onConfirm = async (messageId: number, action: 'approve' | 'reject') => {
    await machine.confirm(messageId, action);
    void qc.invalidateQueries({ queryKey: ['ai-conversations'] });
  };

  const onNew = async () => { await machine.open(null); };
  const onSelect = async (cid: number) => { await machine.open(cid); };
  const onDelete = async (cid: number) => {
    try {
      await api.delAiConversation(cid);
      if (machine.snapshot().conversationId === cid) await machine.open(null);
      void qc.invalidateQueries({ queryKey: ['ai-conversations'] });
    } catch (e) { toast.error(e instanceof Error ? e.message : '删除失败'); }
  };

  const list = conversations.data?.data ?? [];
  const blocked = blockedReason(snap);

  return (
    <div className="flex h-full gap-5">
      {showList && (
        <aside className="flex w-60 shrink-0 flex-col rounded-xl border border-border bg-card">
          <div className="p-3">
            <Button size="sm" className="w-full" onClick={onNew}><Plus size={14} />新会话</Button>
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            {list.map(c => (
              <div key={c.id}
                className={'group flex items-center gap-1 rounded-lg px-2 ' +
                  (snap.conversationId === c.id ? 'bg-primary/10' : 'hover:bg-muted')}>
                <button className="flex-1 truncate py-2 text-left text-[13px]" onClick={() => onSelect(c.id)}>
                  {c.title || '(未命名)'}
                </button>
                <button className="opacity-0 transition group-hover:opacity-100" onClick={() => onDelete(c.id)}>
                  <Trash2 size={14} className="text-destructive" />
                </button>
              </div>
            ))}
            {!list.length && <p className="px-2 py-4 text-xs text-muted-foreground">还没有会话</p>}
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-sm font-medium">AI 助手</span>
          <Button variant="ghost" size="sm" onClick={() => setShowList(v => !v)}>
            {showList ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <ChatMessages items={snap.items} streaming={snap.streaming} onConfirm={onConfirm} />
          {snap.error && (
            <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {snap.error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex items-end gap-2 border-t border-border p-3">
          <textarea
            className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            rows={1}
            value={input}
            placeholder={blocked
              ?? (snap.conversationId == null ? '开始新对话…' : '输入消息,Enter 发送 / Shift+Enter 换行')}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void onSend(); }
            }}
          />
          {snap.streaming
            ? <Button variant="outline" onClick={() => machine.abort()}><Square size={14} />停止</Button>
            : <Button onClick={onSend} disabled={!input.trim() || !!blocked}><Send size={14} />发送</Button>}
        </div>
      </div>
    </div>
  );
}
