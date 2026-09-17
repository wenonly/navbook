// 统一 AI 助手气泡(主题可定制)——从 compass 抽取,行为与 machine 协议完全一致:
// 登录管理员可见 / 打开续接最近会话 / DO 重挂续流 / 服务端停止 / 确认卡阻塞 / 交错工具卡。
// 主题化:所有视觉走 CSS 变量(theme prop 注入,值可透传宿主 var(--x) 以跟随暗色模式);
// 图标经 icon prop 替换;面板尺寸/圆角/阴影可调。样式见 ./assistant.css(.nba-*)。
import { useEffect, useRef, useState, useSyncExternalStore, lazy, Suspense, type CSSProperties, type ReactNode } from 'react';
import { ChatMachine, createApiClient, activityLabel, blockedReason } from '../index';
import type { ChatMessageDto, ChatSseEvent, SessionInfo, UiItem } from '../chat/types';
import './assistant.css';

// markdown 库较重,懒加载分包
const Markdown = lazy(() => import('./Markdown'));

export interface AssistantTheme {
  bg: string; fg: string; muted: string; faint: string;
  border: string; field: string;
  accent: string; accentStrong?: string; accentFg?: string;
  font?: string; radius?: number; radiusBtn?: number; shadow?: string;
  bubbleSize?: number; panelWidth?: number; panelHeight?: number;
}

const api = createApiClient({ onUnauthorized: false });

let machine: ChatMachine | null = null;
function getMachine(): ChatMachine {
  // 模块级单例:同页多实例共享一份会话状态(machine 本就为单例设计)
  machine ??= new ChatMachine({
    history: async (cid: number): Promise<ChatMessageDto[]> => (await api.aiMessages(cid)).data,
    stream: (body, signal) => api.streamChat(body, signal) as AsyncGenerator<ChatSseEvent>,
    attach: (cid, signal) => api.attachEvents(cid, signal) as AsyncGenerator<ChatSseEvent>,
  });
  return machine;
}

function themeVars(t: AssistantTheme): CSSProperties {
  return {
    '--nba-bg': t.bg, '--nba-fg': t.fg, '--nba-muted': t.muted, '--nba-faint': t.faint,
    '--nba-border': t.border, '--nba-field': t.field,
    '--nba-accent': t.accent, '--nba-accent-strong': t.accentStrong ?? t.accent,
    '--nba-accent-fg': t.accentFg ?? '#fff',
    '--nba-font': t.font ?? 'inherit',
    '--nba-radius': t.radius != null ? `${t.radius}px` : '12px',
    '--nba-radius-btn': t.radiusBtn != null ? `${t.radiusBtn}px` : '8px',
    '--nba-shadow': t.shadow ?? '0 8px 24px rgb(16 24 40 / 0.12)',
    '--nba-bubble': t.bubbleSize != null ? `${t.bubbleSize}px` : '3rem',
    '--nba-w': t.panelWidth != null ? `${t.panelWidth}px` : '380px',
    '--nba-h': t.panelHeight != null ? `${t.panelHeight}px` : '560px',
  } as CSSProperties;
}

export function AssistantBubble({
  session, theme, icon, storageKey = 'navbook-ai-cid', title = 'AI 助手', placeholder,
}: {
  session: SessionInfo | null;
  theme: AssistantTheme;
  /** 气泡按钮内图标(默认机器人) */
  icon?: ReactNode;
  storageKey?: string;
  title?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!session?.username) return null;   // 权限隔离:游客一律不见
  return (
    <div className="nba-root" style={themeVars(theme)}>
      {open
        ? <ChatPanel onClose={() => setOpen(false)} storageKey={storageKey} title={title} placeholder={placeholder} />
        : <button className="nba-bubble-btn" onClick={() => setOpen(true)} title={title} aria-label={title}>
            {icon ?? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a7 7 0 0 1 7 7v3l2 3-4 1a7 7 0 0 1-10 0l-4-1 2-3V9a7 7 0 0 1 7-7z" />
                <circle cx="9.5" cy="10" r="1" fill="currentColor" /><circle cx="14.5" cy="10" r="1" fill="currentColor" />
              </svg>
            )}
          </button>}
    </div>
  );
}

function ChatPanel({ onClose, storageKey, title, placeholder }: {
  onClose: () => void; storageKey: string; title: string; placeholder?: string;
}) {
  const machine = getMachine();
  const snap = useSyncExternalStore(machine.subscribe, machine.snapshot);
  const [input, setInput] = useState('');
  const [tick, setTick] = useState(0);   // running 卡计时(1s)
  const bottomRef = useRef<HTMLDivElement>(null);
  const blocked = blockedReason(snap);

  useEffect(() => {
    if (machine.snapshot().conversationId != null) return;
    const lastCid = Number(localStorage.getItem(storageKey) ?? 0);
    api.aiConversations().then(async res => {
      const target = res.data.find(c => c.id === lastCid) ?? res.data[0];
      await machine.open(target ? target.id : null);
    }).catch(() => {});
  }, [storageKey]);

  useEffect(() => {
    if (snap.conversationId) localStorage.setItem(storageKey, String(snap.conversationId));
  }, [snap.conversationId, storageKey]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [snap.items.length]);
  useEffect(() => {
    if (!snap.streaming) return;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [snap.streaming]);
  void tick;

  const send = async () => {
    const text = input.trim();
    if (!text || snap.streaming) return;
    setInput('');
    await machine.send(text);
  };

  return (
    <div className="nba-panel">
      <div className="nba-head">
        <span className="nba-title">{title}</span>
        <button className="nba-close" onClick={onClose} aria-label="关闭">✕</button>
      </div>
      <div className="nba-body">
        {!snap.items.length && (
          <p className="nba-empty">可以问我站内有什么、帮我搜链接、增删改书签(写操作会请你确认)。</p>
        )}
        {snap.items.map((item, i) => <Item key={i} item={item} />)}
        {snap.streaming && (
          <div className="nba-status">
            <svg className="nba-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <circle cx="12" cy="12" r="9" opacity=".25" /><path d="M4 12a8 8 0 018-8" />
            </svg>
            <span>{activityLabel(snap)}</span>
          </div>
        )}
        {snap.error && <p className="nba-error">{snap.error}</p>}
        <div ref={bottomRef} />
      </div>
      <div className="nba-composer">
        <textarea
          className="nba-input" rows={1} value={input}
          placeholder={blocked ?? placeholder ?? '输入消息…'}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        {snap.streaming
          ? <button className="nba-stop" onClick={() => {
              if (snap.conversationId != null) void api.stopAiConversation(snap.conversationId).catch(() => {});
              machine.abort();
            }}>停止</button>
          : <button className="nba-send" disabled={!input.trim() || !!blocked} onClick={send}>发送</button>}
      </div>
    </div>
  );
}

function Item({ item }: { item: UiItem }) {
  const machine = getMachine();
  if (item.kind === 'error') return <p className="nba-error">{item.text}</p>;
  if (item.kind === 'user') {
    return <div className="nba-user"><div className="nba-user-bubble">{item.text}</div></div>;
  }
  if (item.kind === 'assistant') {
    return (
      <div className="nba-assistant">
        {item.reasoning && (
          <details className="nba-thinking">
            <summary>思考过程</summary>
            <pre>{item.reasoning}</pre>
          </details>
        )}
        {(item.text || item.streaming) && (
          <div className="nba-answer">
            {item.text
              ? <Suspense fallback={<span style={{ whiteSpace: 'pre-wrap' }}>{item.text}</span>}><Markdown text={item.text} /></Suspense>
              : '…'}
          </div>
        )}
      </div>
    );
  }
  // tool:pending = 写操作确认卡;running = 执行中(spinner+计时);其余为结果卡
  const badge = { running: '执行中', ok: '完成', error: '失败', rejected: '已取消', pending: '待确认' }[item.status];
  const stateCls = item.status === 'ok' ? 'nba-ok' : item.status === 'error' ? 'nba-err' : item.status === 'pending' ? 'nba-wait' : '';
  return (
    <div className={`nba-tool${item.status === 'pending' ? ' nba-pending' : ''}`}>
      <div className="nba-tool-head">
        {item.status === 'running' && (
          <svg className="nba-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <circle cx="12" cy="12" r="9" opacity=".25" /><path d="M4 12a8 8 0 018-8" />
          </svg>
        )}
        <span className="nba-tool-name">{item.name}</span>
        <span className={`nba-tool-state ${stateCls}`}>{badge}</span>
        {item.status === 'running' && item.startedAt != null && (
          <span className="nba-tool-state"> · {Math.max(0, Math.floor((Date.now() - item.startedAt) / 1000))}s</span>
        )}
      </div>
      {item.summary && <div className="nba-tool-summary">{item.summary}</div>}
      {item.status === 'pending' && item.messageId != null && (
        <div className="nba-confirm-row">
          <button className="nba-btn nba-btn-ok" onClick={() => void machine.confirm(item.messageId!, 'approve')}>确认执行</button>
          <button className="nba-btn nba-btn-plain" onClick={() => void machine.confirm(item.messageId!, 'reject')}>取消</button>
        </div>
      )}
    </div>
  );
}
