// UI 无关的聊天状态机:send/confirm/abort 驱动 SSE 事件归约成 items。
// web 与 compass 只做 UI 壳(useSyncExternalStore 订阅 snapshot)。
import type { ChatMessageDto, ChatSseEvent, ChatStreamBody } from './types';

export interface ChatTransport {
  history(cid: number): Promise<ChatMessageDto[]>;
  stream(body: ChatStreamBody, signal?: AbortSignal): AsyncGenerator<ChatSseEvent>;
  /** 重挂:running 会话的事件流(hello→回放→实时);无 attach 能力则跳过 */
  attach?(cid: number, signal?: AbortSignal): AsyncGenerator<ChatSseEvent>;
}

export type UiItem =
  | { kind: 'user'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'assistant'; id: number | null; text: string; reasoning: string; streaming: boolean }
  | {
      kind: 'tool'; id: string; name: string; args: unknown;
      danger: 'read' | 'write';
      status: 'running' | 'ok' | 'error' | 'pending' | 'rejected';
      summary: string; data?: unknown; messageId?: number;
      startedAt?: number;   // running 卡的起始时间戳(UI 计时用;历史回放无此态)
    };

export interface ChatSnapshot {
  conversationId: number | null;
  items: UiItem[];
  streaming: boolean;
  error: string | null;
}

export class ChatMachine {
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private state: ChatSnapshot = { conversationId: null, items: [], streaming: false, error: null };
  private transport: ChatTransport;

  constructor(transport: ChatTransport) {
    this.transport = transport;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  snapshot = () => this.state;
  private set(patch: Partial<ChatSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** 载入历史(或 cid=null 开新会话清空);running 会话自动重挂续流(事件流呈现回合,跳过 live 行) */
  async open(cid: number | null) {
    this.abort();
    if (cid == null) {
      this.set({ conversationId: null, items: [], streaming: false, error: null });
      return;
    }
    const msgs = await this.transport.history(cid);
    const items = msgs
      .filter(m => !(m.role === 'assistant' && (m.content as any)?.live))
      .map(toItem);
    this.set({ conversationId: cid, items, streaming: false, error: null });
    void this.attachLoop(cid);
  }

  /** 重挂循环:hello{running}→回放+实时;hello{!running}/done 即收 */
  private async attachLoop(cid: number) {
    if (!this.transport.attach) return;
    this.controller = new AbortController();
    try {
      for await (const ev of this.transport.attach(cid, this.controller.signal)) {
        if (ev.type === 'hello') {
          if (!ev.running) break;
          this.set({ streaming: true });
          continue;
        }
        if (ev.type === 'resync') {
          this.set({ error: '直播缓冲超限,已截断;刷新页面可查看完整记录' });
          continue;
        }
        this.reduce(ev);
        if (ev.type === 'done') break;
      }
    } catch { /* 重挂连接断:保持当前状态 */ }
    this.finishStreaming();
  }

  async send(text: string) {
    if (!text.trim() || this.state.streaming) return;
    // 串行语义:存在待确认操作时阻塞新消息(Claude 权限提示同款);原因由 blockedReason() 供 UI 展示
    if (this.state.items.some(i => i.kind === 'tool' && i.status === 'pending')) return;
    await this.streamOnce({ text }, item => [
      { kind: 'user', text } as UiItem, item,
    ]);
  }

  /** 确认/拒绝写操作(对话里不再插用户消息) */
  async confirm(messageId: number, action: 'approve' | 'reject') {
    if (this.state.streaming) return;
    await this.streamOnce({ confirm: { message_id: messageId, action } }, item => [item]);
  }

  abort() {
    this.controller?.abort();
    this.controller = null;
  }

  private async streamOnce(
    body: { text?: string; confirm?: ChatStreamBody['confirm'] },
    seed: (placeholder: UiItem) => UiItem[],
  ) {
    this.controller = new AbortController();
    const assistant: UiItem = { kind: 'assistant', id: null, text: '', reasoning: '', streaming: true };
    // 追加而非替换:confirm 续流时必须保留既有 items(含待确认卡)
    this.set({
      items: [...this.state.items, ...seed(assistant)],
      streaming: true,
      error: null,
    });
    try {
      for await (const ev of this.transport.stream(
        {
          cid: this.state.conversationId ?? 0,
          ...(body.text !== undefined ? { message: body.text } : {}),
          ...(body.confirm ? { confirm: body.confirm } : {}),
        },
        this.controller.signal,
      )) {
        this.reduce(ev);
        if (!this.state.streaming && ev.type === 'done') break;
      }
    } catch {
      // abort(用户停止)或网络断:就地收尾
    }
    this.finishStreaming();
  }

  private finishStreaming() {
    if (!this.state.streaming) return;
    const items = this.state.items.map(i =>
      i.kind === 'assistant' && i.streaming ? { ...i, streaming: false } : i);
    this.set({ items, streaming: false });
  }

  /** 追加到"当前 streaming 的 assistant 气泡";若已被工具卡关闭/不存在,则开新气泡(ReAct 多步交错的关键) */
  private appendAssistant(items: UiItem[], field: 'text' | 'reasoning', value: string) {
    let idx = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].kind === 'assistant') { idx = i; break; }
      // 气泡与末尾之间隔着工具卡 → 该气泡已关闭,需要新开
      if (items[i].kind === 'tool') break;
    }
    if (idx < 0 || !(items[idx] as Extract<UiItem, { kind: 'assistant' }>).streaming) {
      items.push({ kind: 'assistant', id: null, text: '', reasoning: '', streaming: true });
      idx = items.length - 1;
    }
    items[idx] = { ...(items[idx] as any), [field]: (items[idx] as any)[field] + value };
  }

  private reduce(ev: ChatSseEvent) {
    const items = [...this.state.items];
    const lastAssistant = () => {
      let idx = -1;
      for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'assistant') { idx = i; break; }
      return idx;
    };
    switch (ev.type) {
      case 'conversation':
        this.set({ conversationId: ev.cid });
        return;
      case 'delta': {
        this.appendAssistant(items, 'text', ev.text);
        this.set({ items });
        return;
      }
      case 'reasoning': {
        this.appendAssistant(items, 'reasoning', ev.text);
        this.set({ items });
        return;
      }
      case 'tool_call': {
        // 工具卡到达 = 当前 assistant 气泡结束(ReAct 步边界);
        // 之后的 delta 会开新气泡,工具卡因此交错嵌在聊天流里而非堆到末尾
        const li = lastAssistant();
        if (li >= 0 && (items[li] as Extract<UiItem, { kind: 'assistant' }>).streaming) {
          items[li] = { ...(items[li] as any), streaming: false };
        }
        items.push({
          kind: 'tool', id: ev.id, name: ev.name, args: ev.args, danger: ev.danger,
          status: ev.danger === 'write' ? 'pending' : 'running', summary: '',
          ...(ev.danger === 'write' ? {} : { startedAt: Date.now() }),
        });
        this.set({ items });
        return;
      }
      case 'tool_result': {
        const i = items.findIndex(x => x.kind === 'tool' && x.id === ev.id);
        if (i >= 0) {
          const cur = items[i] as Extract<UiItem, { kind: 'tool' }>;
          const status: typeof cur.status = ev.ok
            ? 'ok'
            : cur.danger === 'write' && ev.summary.includes('取消') ? 'rejected' : 'error';
          items[i] = { ...cur, status, summary: ev.summary, data: ev.data };
        }
        this.set({ items });
        return;
      }
      case 'confirm_required': {
        const i = items.findIndex(x => x.kind === 'tool' && x.id === ev.id);
        if (i >= 0) items[i] = { ...(items[i] as any), status: 'pending', summary: ev.summary, messageId: ev.messageId };
        this.set({ items });
        return;
      }
      case 'error':
        this.set({ items, error: ev.msg });
        return;
      case 'done':
        this.set({ items });
        this.finishStreaming();
        return;
    }
  }
}

/** 阻塞原因(streaming 中 / 有待确认操作);null = 可发新消息。UI 据此禁用 composer */
export function blockedReason(s: ChatSnapshot): string | null {
  if (s.streaming) return 'AI 正在处理,请稍候…';
  if (s.items.some(i => i.kind === 'tool' && i.status === 'pending')) {
    return '请先确认或取消上方的待执行操作';
  }
  return null;
}

/** streaming 期间的状态条文案:正在思考… → 正在调用 <tool>… → 正在生成回复… */
export function activityLabel(s: Pick<ChatSnapshot, 'items' | 'streaming'>): string {
  if (!s.streaming) return '';
  for (let i = s.items.length - 1; i >= 0; i--) {
    const it = s.items[i];
    if (it.kind === 'tool' && it.status === 'running') return `正在调用 ${it.name}…`;
  }
  const last = s.items.at(-1);
  if (last?.kind === 'assistant' && (last.text || last.reasoning)) return '正在生成回复…';
  return '正在思考…';
}

function toItem(m: ChatMessageDto): UiItem {
  const c = m.content as any;
  if (m.role === 'error') return { kind: 'error', text: c.text ?? '' };
  if (m.role === 'user') return { kind: 'user', text: c.text ?? '' };
  if (m.role === 'assistant') {
    return { kind: 'assistant', id: m.id, text: c.text ?? '', reasoning: c.reasoning ?? '', streaming: false };
  }
  return {
    kind: 'tool', id: c.toolCallId ?? '', name: c.name ?? '', args: c.args,
    danger: 'read',                     // 历史回放不区分 danger(渲染不依赖)
    status: c.status ?? 'ok', summary: c.summary ?? '', data: c.result,
  };
}
