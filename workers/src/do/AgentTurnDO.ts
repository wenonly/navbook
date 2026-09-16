// AgentTurnDO:每会话一个 Durable Object 实例(id = conv-<cid>)。
// 职责 = 传输层:回合在实例内运行(与客户端连接解耦,断连/关页继续跑)、
// 事件缓冲(重挂=重放整条流)、SSE 广播、stop 控制、alarm 崩溃兜底。
// 真相全在 agent(落库)与 D1;本实例内存仅易失状态,丢实例不丢数据。
import { DurableObject } from 'cloudflare:workers';
import { getDb } from '../db/client';
import { loadAiConfig } from '../ai/config';
import { runAgentTurn } from '../ai/agent';
import { OpenAiCompatProvider } from '../ai/provider';
import { McpRegistry } from '../ai/mcp';
import { setRunning, clearRunning, isRunning, clearLiveFlags } from '../ai/conversations';
import type { ChatSseEvent } from '../ai/types';

const ALARM_MS = 190_000;          // 回合兜底闹钟(回合上限 180s + 余量)
const BUFFER_MAX = 3000;           // 事件缓冲上限,超限发 resync(前端全量重读)
const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache',
  'x-accel-buffering': 'no',
};

/** SSE 帧 */
function frame(ev: ChatSseEvent): string {
  return `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
}

/** 单个订阅者(TransformStream writer 的薄封装,close 幂等)。
 * 关键防御:客户端断连后(经 TextEncoderStream 链)writer.write 可能永不结算,
 * 写入竞速 2s 超时并标记 closed——绝不让坏订阅挂死回合收尾(broadcast/done/cleanup)。 */
class Sub {
  closed = false;
  constructor(private writer: WritableStreamDefaultWriter<string>) {}
  async write(s: string) {
    if (this.closed) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.writer.write(s),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('sub write timeout')), 2000); }),
      ]);
    } catch {
      this.closed = true;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.writer.close().catch(() => {});
  }
}

export class AgentTurnDO extends DurableObject {
  private running = false;
  private abortCtl: AbortController | null = null;
  /** 本回合事件帧缓冲(重挂回放;连续 delta/reasoning 帧合并控制内存) */
  private frames: string[] = [];
  private subs = new Set<Sub>();

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === '/turn') return this.handleTurn(req);
    if (path === '/events') return this.handleEvents();
    if (path === '/stop') return this.handleStop();
    return Response.json({ code: -404, msg: 'unknown DO route' }, { status: 404 });
  }

  /** 开回合:SSE 直播;断连不终止(计费健康:回合结束由我们主动关流) */
  private async handleTurn(req: Request): Promise<Response> {
    if (this.running) {
      return Response.json({ code: -2000, msg: '本会话正在处理上一条消息,请稍候' }, { status: 409 });
    }
    const p = await req.json<{ cid: number; message?: string; confirm?: { messageId: number; action: 'approve' | 'reject' } }>();
    const db = getDb(this.env.DB);
    const cfg = await loadAiConfig(db);

    this.running = true;
    this.frames = [];
    this.abortCtl = new AbortController();
    await setRunning(db, p.cid).catch(() => {});
    await this.ctx.storage.setAlarm(Date.now() + ALARM_MS).catch(() => {});

    const { readable, writable } = new TransformStream<string, string>();
    const sub = new Sub(writable.getWriter());
    this.subs.add(sub);

    // 回合不 await:fetch 立即返回 SSE,floating promise 由 DO 输出门保持存活至结算
    void this.runTurn(db, cfg, p).catch(async () => {
      // 保命:agent 不应 throw,但任何泄漏异常也要收尾
      await this.broadcast({ type: 'error', code: -2000, msg: 'AI 服务异常' }).catch(() => {});
    }).finally(() => this.cleanup(p.cid));

    // 心跳:静默期防边缘节点掐连接;回合结束 cleanup clearInterval
    const hb = setInterval(() => void sub.write(': hb\n\n').catch(() => {}), 15_000);
    this.hbTimers.add(hb);
    return new Response(readable.pipeThrough(new TextEncoderStream()), { headers: SSE_HEADERS });
  }

  private hbTimers = new Set<ReturnType<typeof setInterval>>();

  private async runTurn(db: ReturnType<typeof getDb>, cfg: Awaited<ReturnType<typeof loadAiConfig>>, p: { cid: number; message?: string; confirm?: { messageId: number; action: 'approve' | 'reject' } }) {
    await runAgentTurn(
      {
        db,
        provider: new OpenAiCompatProvider(),
        ...(cfg.mcpServers.length ? { mcp: new McpRegistry(cfg.mcpServers) } : {}),
      },
      cfg,
      {
        conversationId: p.cid,
        ...(p.message !== undefined ? { message: p.message } : {}),
        ...(p.confirm ? { confirm: p.confirm } : {}),
        signal: this.abortCtl!.signal,
        emit: async ev => { this.buffer(ev); await this.broadcast(ev); },
      },
    );
  }

  /** 重挂:hello → (running? 回放本回合全部帧 + 实时转发 : done 即关) */
  private async handleEvents(): Promise<Response> {
    const { readable, writable } = new TransformStream<string, string>();
    const sub = new Sub(writable.getWriter());
    let hello = `event: hello\ndata: ${JSON.stringify({ type: 'hello', running: this.running })}\n\n`;
    if (!this.running) hello += frame({ type: 'done', messageIds: [] });
    else {
      this.subs.add(sub);
      // 回放缓冲(副本,防迭代中被并发 push)
      hello += this.frames.join('');
    }
    void sub.write(hello).catch(() => {});
    if (!this.running) void sub.close();
    return new Response(readable.pipeThrough(new TextEncoderStream()), { headers: SSE_HEADERS });
  }

  /** 停止:abort 控制器(provider 流中断→agent 落库 truncated→done{stopped});幂等 */
  private async handleStop(): Promise<Response> {
    this.abortCtl?.abort();
    return Response.json({ code: 0, data: null });
  }

  private buffer(ev: ChatSseEvent) {
    if (ev.type === 'delta' || ev.type === 'reasoning') {
      // 合并连续同类帧(回放粒度变粗无妨,省内存)
      const last = this.frames[this.frames.length - 1];
      if (last) {
        const lastEv = JSON.parse(last.slice(last.indexOf('data: ') + 6, -2)) as ChatSseEvent;
        if (lastEv.type === ev.type) {
          const merged = { ...ev, text: lastEv.text + ev.text } as ChatSseEvent;
          this.frames[this.frames.length - 1] = frame(merged);
          return;
        }
      }
    }
    this.frames.push(frame(ev));
    if (this.frames.length > BUFFER_MAX) {
      // 超限:丢弃最旧并标记 gap(极罕见;前端收到 resync 全量重读)
      this.frames.splice(0, this.frames.length - BUFFER_MAX);
      this.frames.unshift(frame({ type: 'resync' }));
    }
  }

  private async broadcast(ev: ChatSseEvent) {
    const f = frame(ev);
    for (const s of this.subs) {
      await s.write(f);
      if (s.closed) this.subs.delete(s);   // 坏订阅(超时/已断)立即摘除
    }
  }

  /** 回合收尾:清状态、关全部订阅(计费健康:done 即关,空闲 DO 休眠零计费) */
  private cleanup = async (cid: number) => {
    this.running = false;
    this.abortCtl = null;
    for (const t of this.hbTimers) clearInterval(t);
    this.hbTimers.clear();
    await clearRunning(getDb(this.env.DB), cid).catch(() => {});
    await this.ctx.storage.deleteAlarm().catch(() => {});
    for (const s of this.subs) void s.close();
    this.subs.clear();
  };

  /** 崩溃兜底:实例重启内存已空,若 DB 仍 running 且超时 → 清 live/标 truncated/复位 */
  async alarm(): Promise<void> {
    if (this.running) return;   // 回合仍在跑(正常结束会删闹钟;走到这说明异常慢,留待下轮)
    const db = getDb(this.env.DB);
    const cid = Number((this.ctx.id.name ?? '').replace('conv-', '')) || 0;
    if (!cid || !(await isRunning(db, cid))) return;
    const { listMessages, updateMessageContent } = await import('../ai/conversations');
    const msgs = await listMessages(db, cid);
    for (const m of msgs) {
      if (m.role !== 'assistant' || !(m.content as any)?.live) continue;
      await updateMessageContent(db, m.id, { ...(m.content as any), live: undefined, truncated: true }).catch(() => {});
    }
    await clearRunning(db, cid).catch(() => {});
  }
}
