// 仅登录管理员可见(session.username 存在才渲染);compass 自有 token 体系,不引 shadcn。
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChatMachine, createApiClient } from '@navbook/shared';
import type { ChatMessageDto, ChatSseEvent, SessionInfo, UiItem } from '@navbook/shared';

const api = createApiClient({ onUnauthorized: false });

const machine = new ChatMachine({
  history: async (cid: number): Promise<ChatMessageDto[]> => (await api.aiMessages(cid)).data,
  stream: (body, signal) => api.streamChat(body, signal) as AsyncGenerator<ChatSseEvent>,
});

const CID_KEY = 'compass-ai-cid';

export default function AssistantBubble({ session }: { session: SessionInfo | null }) {
  const [open, setOpen] = useState(false);
  if (!session?.username) return null;   // 权限隔离:游客一律不见
  return open ? <ChatPanel onClose={() => setOpen(false)} /> : <BubbleButton onOpen={() => setOpen(true)} />;
}

function BubbleButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title="AI 助手"
      className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full
                 bg-accent text-white shadow-hover transition hover:bg-accent-strong"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a7 7 0 0 1 7 7v3l2 3-4 1a7 7 0 0 1-10 0l-4-1 2-3V9a7 7 0 0 1 7-7z" />
        <circle cx="9.5" cy="10" r="1" fill="currentColor" /><circle cx="14.5" cy="10" r="1" fill="currentColor" />
      </svg>
    </button>
  );
}

function ChatPanel({ onClose }: { onClose: () => void }) {
  const snap = useSyncExternalStore(machine.subscribe, machine.snapshot);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // 打开即续接最近会话(spec:单会话模式,不放会话列表)
  useEffect(() => {
    if (machine.snapshot().conversationId != null) return;
    const lastCid = Number(localStorage.getItem(CID_KEY) ?? 0);
    api.aiConversations().then(async res => {
      const target = res.data.find(c => c.id === lastCid) ?? res.data[0];
      await machine.open(target ? target.id : null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (snap.conversationId) localStorage.setItem(CID_KEY, String(snap.conversationId));
  }, [snap.conversationId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [snap.items.length]);

  const send = async () => {
    const text = input.trim();
    if (!text || snap.streaming) return;
    setInput('');
    await machine.send(text);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[560px] w-[380px] max-w-[calc(100vw-2rem)] flex-col
                    overflow-hidden rounded-card border border-border bg-card shadow-pop">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium text-fg">AI 助手</span>
        <button className="text-faint hover:text-fg" onClick={onClose}>✕</button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {!snap.items.length && (
          <p className="px-2 py-8 text-center text-xs text-faint">
            可以问我站内有什么、帮我搜链接、增删改书签(写操作会请你确认)。
          </p>
        )}
        {snap.items.map((item, i) => <Item key={i} item={item} />)}
        {snap.error && (
          <p className="rounded-input border border-red-300/60 bg-red-50/60 px-3 py-2 text-xs text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-400">
            {snap.error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-border p-3">
        <textarea
          className="max-h-24 min-h-9 flex-1 resize-none rounded-input border border-border bg-field px-3 py-1.5
                     text-sm text-fg outline-none focus:border-accent"
          rows={1}
          value={input}
          placeholder="输入消息…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        {snap.streaming
          ? <button className="rounded-input border border-border px-3 py-1.5 text-xs text-fg" onClick={() => machine.abort()}>停止</button>
          : <button className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong" onClick={send}>发送</button>}
      </div>
    </div>
  );
}

function Item({ item }: { item: UiItem }) {
  if (item.kind === 'user') {
    return <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl bg-accent px-3.5 py-2 text-sm text-white whitespace-pre-wrap">{item.text}</div>
    </div>;
  }
  if (item.kind === 'assistant') {
    return <div className="space-y-1.5">
      {item.reasoning && (
        <details className="rounded-lg border border-dashed border-border px-2.5 py-1.5">
          <summary className="cursor-pointer text-xs text-faint">思考过程</summary>
          <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-faint">{item.reasoning}</pre>
        </details>
      )}
      {(item.text || item.streaming) && (
        <div className="max-w-[85%] rounded-2xl bg-field px-3.5 py-2 text-sm text-fg whitespace-pre-wrap">
          {item.text || '…'}
        </div>
      )}
    </div>;
  }
  // tool:pending = 写操作确认卡;其余为执行卡
  const badge = { running: '执行中', ok: '完成', error: '失败', rejected: '已取消', pending: '待确认' }[item.status];
  return (
    <div className={'max-w-[85%] rounded-xl border px-3 py-2 text-xs ' +
      (item.status === 'pending' ? 'border-amber-500/60 bg-amber-500/5' : 'border-border')}>
      <div className="flex items-center gap-2">
        <span className="font-medium text-fg">{item.name}</span>
        <span className="text-faint">{badge}</span>
      </div>
      {item.summary && <p className="mt-1 text-faint">{item.summary}</p>}
      {item.status === 'pending' && item.messageId != null && (
        <div className="mt-2 flex gap-2">
          <button className="rounded-input bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-strong"
            onClick={() => void machine.confirm(item.messageId!, 'approve')}>确认执行</button>
          <button className="rounded-input border border-border px-3 py-1 text-xs text-fg"
            onClick={() => void machine.confirm(item.messageId!, 'reject')}>取消</button>
        </div>
      )}
    </div>
  );
}
