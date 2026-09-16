// AgentTurnDO 集成测试:真实 DO(vitest-pool-workers 同 isolate 运行),
// 伪厂商 = 补丁 globalThis.fetch(OpenAiCompatProvider 构造时绑定当前全局)。
// 剧本:断连续跑 / 重挂回放 / 服务端 stop / 同会话并发拒绝 / 厂商错误落库。
// (alarm 崩溃自愈无法从外部触发;逻辑由 agent 中断测试 + Sub 竞速防御覆盖)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { resetTables, seedUser } from '../helpers';
import { saveAiConfig } from '../../src/ai/config';
import { createConversation, listMessages, isRunning } from '../../src/ai/conversations';

const db = () => getDb(env.DB);
const enc = new TextEncoder();

beforeEach(async () => {
  await resetTables();
  await seedUser();
  await saveAiConfig(db(), {
    providers: [{ id: 'p1', name: 'X', preset: 'custom', baseUrl: 'https://fake/v1', apiKey: 'sk-x', model: 'm' }],
    activeProviderId: 'p1', systemPrompt: '', mcpServers: [], toolPolicy: {},
  });
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function makeGate() {
  let resolve!: () => void;
  const p = new Promise<void>(r => { resolve = r; });
  return { release: resolve, wait: () => p };
}

/** 伪厂商 SSE:emit delta1 → 等门(或 abort,以 AbortError error 流)→ emit delta2 → finish → [DONE] */
function gatedProviderFetch(gate: { wait: () => Promise<void> }) {
  return (async (_input: unknown, init?: RequestInit) => new Response(new ReadableStream({
    async start(ctrl) {
      const chunk = (o: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      chunk({ choices: [{ delta: { content: '第一段' }, finish_reason: null }] });
      // 真实 fetch 会响应 signal:abort 时以 AbortError 拒绝(start reject → 流 errored → provider 读循环抛出)
      await Promise.race([
        gate.wait(),
        new Promise<never>((_, rej) => init?.signal?.addEventListener('abort',
          () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
      ]);
      chunk({ choices: [{ delta: { content: '第二段' }, finish_reason: null }] });
      chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
      ctrl.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
}

const stub = (cid: number) => env.AGENT.get(env.AGENT.idFromName(`conv-${cid}`));
const startTurn = (cid: number, message = 'hi') =>
  stub(cid).fetch('https://agent-do/turn', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cid, message }),
  });

async function waitUntil(cond: () => Promise<boolean>, ms = 10000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('waitUntil 超时');
}

/** 流读取器:收帧到字符串(显式 reader,避免二次消费 body) */
class Frames {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private dec = new TextDecoder();
  buf = '';
  constructor(body: ReadableStream<Uint8Array>) { this.reader = body.getReader(); }
  async readUntil(match: string, ms = 8000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!this.buf.includes(match)) {
      if (Date.now() > deadline) throw new Error(`readUntil 超时:等「${match}」,已有 ${this.buf.length} 字节`);
      const { done, value } = await Promise.race([
        this.reader.read(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('read 超时')), deadline - Date.now())),
      ]);
      if (done) return;
      this.buf += this.dec.decode(value!);
    }
  }
  cancel() { return this.reader.cancel().catch(() => {}); }
}

describe('AgentTurnDO', () => {
  it('断连续跑:客户端中途断开,回合继续跑完并完整落库(live 清除)', { timeout: 20000 }, async () => {
    const gate = makeGate();
    globalThis.fetch = gatedProviderFetch(gate);
    const conv = await createConversation(db(), 't');

    const res = await startTurn(conv.id);
    const frames = new Frames(res.body!);
    await frames.readUntil('第一段');
    await frames.cancel();        // 客户端"刷新/关页"
    gate.release();

    await waitUntil(async () => !(await isRunning(db(), conv.id)));
    const msgs = await listMessages(db(), conv.id);
    const assistant = msgs.find(m => m.role === 'assistant')!;
    expect(assistant.content).toMatchObject({ text: '第一段第二段' });
    expect((assistant.content as any).live).toBeUndefined();
  });

  it('重挂:running 时 /events 回 hello{running}+已缓冲帧,续流至 done', { timeout: 20000 }, async () => {
    const gate = makeGate();
    globalThis.fetch = gatedProviderFetch(gate);
    const conv = await createConversation(db(), 't');

    const turnFrames = new Frames((await startTurn(conv.id)).body!);
    await turnFrames.readUntil('第一段');
    // 另一"页面"重挂:hello + 回放(至少含第一段 delta)
    const evFrames = new Frames((await stub(conv.id).fetch('https://agent-do/events')).body!);
    await evFrames.readUntil('hello');
    await evFrames.readUntil('第一段');

    gate.release();
    await evFrames.readUntil('event: done');
    await turnFrames.readUntil('event: done');
    await waitUntil(async () => !(await isRunning(db(), conv.id)));
  });

  it('服务端 stop:半截标 truncated、done{stopped}、无 error、running 清零', { timeout: 20000 }, async () => {
    const gate = makeGate();
    globalThis.fetch = gatedProviderFetch(gate);
    const conv = await createConversation(db(), 't');
    const frames = new Frames((await startTurn(conv.id)).body!);
    await frames.readUntil('第一段');

    const stop = await stub(conv.id).fetch('https://agent-do/stop', { method: 'POST' });
    expect(((await stop.json()) as any).code).toBe(0);
    gate.release();   // provider 流被 abort 中断

    await frames.readUntil('"stopped":true');
    if (frames.buf.includes('event: error')) throw new Error('stop 不应产生 error 事件');
    await waitUntil(async () => !(await isRunning(db(), conv.id)));
    const msgs = await listMessages(db(), conv.id);
    expect(msgs.find(m => m.role === 'assistant')!.content).toMatchObject({ text: '第一段', truncated: true });
  });

  it('同会话并发 /turn 被拒(409);原回合正常完成', { timeout: 20000 }, async () => {
    const gate = makeGate();
    globalThis.fetch = gatedProviderFetch(gate);
    const conv = await createConversation(db(), 't');
    const frames = new Frames((await startTurn(conv.id, '第一条')).body!);
    await frames.readUntil('第一段');

    const second = await startTurn(conv.id, '第二条');
    expect(second.status).toBe(409);
    expect(((await second.json()) as any).msg).toContain('正在处理');

    gate.release();
    await frames.readUntil('event: done');
    await waitUntil(async () => !(await isRunning(db(), conv.id)));
    const msgs = await listMessages(db(), conv.id);
    expect(msgs.filter(m => m.role === 'user')).toHaveLength(1);
  });

  it('厂商错误:error 行落库;重挂 hello{running:false}+done 即关', { timeout: 20000 }, async () => {
    globalThis.fetch = (async () => new Response('bad key', { status: 401 })) as unknown as typeof fetch;
    const conv = await createConversation(db(), 't');
    const frames = new Frames((await startTurn(conv.id)).body!);
    await frames.readUntil('event: error');
    await waitUntil(async () => !(await isRunning(db(), conv.id)));
    expect((await listMessages(db(), conv.id)).some(m => m.role === 'error')).toBe(true);

    const evFrames = new Frames((await stub(conv.id).fetch('https://agent-do/events')).body!);
    await evFrames.readUntil('"running":false');
    await evFrames.readUntil('event: done');
  });
});
