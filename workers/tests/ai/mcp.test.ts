// MCP 客户端/Registry 测试:纯 fetch 注入仿 provider.test.ts,无 D1。
// 安全断言:错误信息与日志绝不包含 URL 与 apiKey(URL 里嵌着密钥)。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpClient, McpRegistry, McpError, resetMcpCache } from '../../src/ai/mcp';
import type { McpServerConfig } from '../../src/ai/types';

const enc = new TextEncoder();
function jsonRpc(result: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(enc.encode(JSON.stringify({ jsonrpc: '2.0', id: 1, result })), {
    status: 200, headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}
function sseRpc(result: unknown, extraHeaders: Record<string, string> = {}): Response {
  const body = `: keep-alive\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result })}\n\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n`;
  return new Response(enc.encode(body), {
    status: 200, headers: { 'content-type': 'text/event-stream', ...extraHeaders },
  });
}

const SERVER: McpServerConfig = { id: 'm1', name: 'Tavily 搜索', url: 'https://mcp.example.com/mcp/?key=SECRETKEY', apiKey: '', trust: 'auto' };

/** 按方法脚本化响应的 fetch;捕获全部请求 */
function scriptedFetch(handlers: Record<string, (body: any) => Response>) {
  const requests: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const fn = (async (input: any, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers)), body });
    const h = handlers[body.method];
    if (!h) return new Response('{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"no handler"}}', {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    return h(body);
  }) as unknown as typeof fetch;
  return { fn, requests };
}

beforeEach(() => { resetMcpCache(); vi.restoreAllMocks(); });

describe('McpClient 握手', () => {
  it('initialize 带协议版本/clientInfo;捕获 mcp-session-id 后续请求回带', async () => {
    const { fn, requests } = scriptedFetch({
      initialize: () => jsonRpc({ protocolVersion: '2025-03-26', serverInfo: { name: 'x' } }, { 'mcp-session-id': 'sess-1' }),
      'tools/list': () => jsonRpc({ tools: [{ name: 'search', description: 'd', inputSchema: { type: 'object' } }] }),
    });
    const c = new McpClient(SERVER, fn);
    await c.initialize();
    expect(c.sessionId).toBe('sess-1');
    await c.listTools();
    const init = requests.find(r => r.body.method === 'initialize');
    expect(init!.body.params.protocolVersion).toBe('2025-03-26');
    expect(init!.body.params.clientInfo.name).toBe('navbook-ai');
    const list = requests.find(r => r.body.method === 'tools/list')!;
    expect(list.headers['mcp-session-id']).toBe('sess-1');
    // 有状态服务器发 initialized 通知
    expect(requests.some(r => r.body.method === 'notifications/initialized')).toBe(true);
  });

  it('无状态服务器(无 session 头)不发通知,仍可 listTools', async () => {
    const { fn, requests } = scriptedFetch({
      initialize: () => jsonRpc({ protocolVersion: '2025-03-26' }),
      'tools/list': () => jsonRpc({ tools: [{ name: 'search', description: '', inputSchema: { type: 'object' } }] }),
    });
    const c = new McpClient(SERVER, fn);
    await c.initialize();
    expect(c.sessionId).toBeNull();
    expect((await c.listTools())).toHaveLength(1);
    expect(requests.some(r => r.body.method === 'notifications/initialized')).toBe(false);
  });

  it('initialize 失败(网络错)不 fatal,继续 listTools 成功(Tavily 无状态场景)', async () => {
    let call = 0;
    const fn = (async (_input: any, init?: RequestInit) => {
      call++;
      const body = JSON.parse(String(init?.body));
      if (body.method === 'initialize') throw new TypeError('network down');
      return jsonRpc({ tools: [{ name: 'search', description: '', inputSchema: { type: 'object' } }] });
    }) as unknown as typeof fetch;
    const c = new McpClient(SERVER, fn);
    await c.initialize();
    expect(call).toBe(1);
    expect((await c.listTools())).toHaveLength(1);
  });

  it('apiKey 非空时发 Authorization Bearer', async () => {
    const { fn, requests } = scriptedFetch({
      initialize: () => jsonRpc({}),
      'tools/list': () => jsonRpc({ tools: [] }),
    });
    const c = new McpClient({ ...SERVER, apiKey: 'bearer-key' }, fn);
    await c.initialize();
    await c.listTools();
    expect(requests[0].headers.authorization).toBe('Bearer bearer-key');
  });
});

describe('McpClient 响应双形态', () => {
  it('同一条 tools/call:JSON 与 SSE 解析结果一致', async () => {
    const payload = { content: [{ type: 'text', text: '结果A' }] };
    const a = new McpClient(SERVER, scriptedFetch({ 'tools/call': () => jsonRpc(payload) }).fn);
    const b = new McpClient(SERVER, scriptedFetch({ 'tools/call': () => sseRpc(payload) }).fn);
    expect(await a.callTool('search', { q: 'x' })).toBe('结果A');
    expect(await b.callTool('search', { q: 'x' })).toBe('结果A');
  });

  it('SSE 帧读完释放连接(reader.cancel 不挂起)', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(ctrl) { ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } })}\n\n`)); },
      cancel() { cancelled = true; },
    });
    const fn = (async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
    const c = new McpClient(SERVER, fn);
    expect(await c.callTool('t', {})).toBe('ok');
    expect(cancelled).toBe(true);
  });
});

describe('McpClient listTools 与拍平', () => {
  it('inputSchema 非对象/缺失 → {type:"object"} 兜底;cursor 分页封顶 20', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `t${i}`, description: '', inputSchema: i % 3 === 0 ? 'bad' : undefined }));
    const { fn } = scriptedFetch({
      'tools/list': (body: any) => body.params?.cursor
        ? jsonRpc({ tools: many.slice(10) })
        : jsonRpc({ tools: many.slice(0, 10), nextCursor: 'p2' }),
    });
    const c = new McpClient(SERVER, fn);
    const tools = await c.listTools();
    expect(tools).toHaveLength(20);   // 封顶
    expect(tools.every(t => t.inputSchema && typeof t.inputSchema === 'object')).toBe(true);
  });

  it('拍平:多 text 用 \\n 连接;非文本占位;structuredContent 兜底;16K 截断标记', async () => {
    const mk = (result: unknown) => new McpClient(SERVER, scriptedFetch({ 'tools/call': () => jsonRpc(result) }).fn);
    expect(await mk({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }).callTool('t', {})).toBe('a\nb');
    expect(await mk({ content: [{ type: 'image', data: 'x' }, { type: 'text', text: 'cap' }] }).callTool('t', {}))
      .toBe('[image 内容]\ncap');
    expect(await mk({ structuredContent: { answer: 42 } }).callTool('t', {})).toBe('{"answer":42}');
    const long = await mk({ content: [{ type: 'text', text: 'x'.repeat(20 * 1024) }] }).callTool('t', {});
    expect(long).toContain('…(结果过长已截断)');
    expect(String(long).length).toBeLessThan(20 * 1024);
  });
});

describe('McpClient 错误与超时', () => {
  it('isError → MCP 工具返回错误', async () => {
    const c = new McpClient(SERVER, scriptedFetch({
      'tools/call': () => jsonRpc({ isError: true, content: [{ type: 'text', text: '配额不足\n第二行' }] }),
    }).fn);
    await expect(c.callTool('t', {})).rejects.toThrow('MCP 工具返回错误:配额不足');
  });

  it('HTTP 401 → 中文错误,不含 URL 与 key', async () => {
    const c2 = new McpClient(SERVER, (async () => new Response('denied', { status: 401 })) as unknown as typeof fetch);
    const e2 = await c2.listTools().catch(e => e as Error);
    expect(e2).toBeInstanceOf(McpError);
    expect(e2.message).toContain('HTTP 401');
    expect(e2.message).not.toContain('SECRETKEY');
    expect(e2.message).not.toContain('mcp.example.com');
  });

  it('JSON-RPC error 对象 → 错误码与消息透出(无 URL/key)', async () => {
    const fn = (async () => new Response(
      enc.encode(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'boom' } })),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;
    const c = new McpClient(SERVER, fn);
    await expect(c.listTools()).rejects.toThrow('错误 -32000:boom');
  });

  it('超时:fetch 永不 resolve + 短超时 → 错误含「超时」', async () => {
    // 真 fetch 会响应 signal 中止,假 fetch 也必须(否则 promise 永不结算)
    const never = (async (_input: any, init?: RequestInit) => {
      await new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
      return new Response();
    }) as unknown as typeof fetch;
    const c = new McpClient(SERVER, never, { list: 50 });
    await expect(c.listTools()).rejects.toThrow('超时');
  });
});

describe('McpRegistry', () => {
  // Response body 只能消费一次,必须每次新建
  const listResp = () => jsonRpc({ tools: [
    { name: 'search', description: '联网搜索', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
  ] });

  it('命名清洗:中文名取拉丁部分,全特殊字符回落 srv;≤64;trust→danger', async () => {
    const { fn } = scriptedFetch({ initialize: () => jsonRpc({}), 'tools/list': () => listResp() });
    const reg = new McpRegistry([
      { id: 'a', name: 'Tavily 搜索!!', url: 'https://a.example.com', apiKey: '', trust: 'auto' },
      { id: 'b', name: '智谱!!!', url: 'https://b.example.com', apiKey: '', trust: 'confirm' },
    ], fn);
    const tools = await reg.resolveTools();
    const names = tools.map(t => t.name);
    expect(names).toContain('mcp_tavily_search');       // 中文剥离取拉丁
    expect(names).toContain('mcp_srv_search');          // 全特殊字符回落 srv
    expect(tools.every(t => t.name.length <= 64)).toBe(true);
    expect(tools.find(t => t.name === 'mcp_tavily_search')!.danger).toBe('read');
    expect(tools.find(t => t.name === 'mcp_srv_search')!.danger).toBe('write');
    // summarize 文案含原始工具名与服务器名
    const t = tools.find(x => x.name === 'mcp_tavily_search')!;
    expect(t.summarize({}, null)).toContain('search(Tavily 搜索!!)');
  });

  it('_2 去重:同名服务器产出同名工具时加后缀,总长 ≤64', async () => {
    const { fn } = scriptedFetch({ initialize: () => jsonRpc({}), 'tools/list': () => listResp() });
    const reg = new McpRegistry([
      { id: 'a', name: 'Srv', url: 'https://a.example.com', apiKey: '', trust: 'auto' },
      { id: 'b', name: 'Srv', url: 'https://b.example.com', apiKey: '', trust: 'auto' },
    ], fn);
    const names = (await reg.resolveTools()).map(t => t.name);
    expect(names).toEqual(['mcp_srv_search', 'mcp_srv_search_2']);
    expect(names.every(n => n.length <= 64)).toBe(true);
  });

  it('单服务器发现失败:warn 后跳过,其余正常', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fn } = scriptedFetch({ initialize: () => jsonRpc({}), 'tools/list': () => listResp() });
    const reg = new McpRegistry([
      { id: 'bad', name: '坏服务器', url: 'https://bad.example.com', apiKey: '', trust: 'auto' },
      { id: 'ok', name: 'Good', url: 'https://good.example.com', apiKey: '', trust: 'auto' },
    ], async (input: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(input).includes('bad')) throw new TypeError('down');
      return (fn as any)(input, init);
    });
    const tools = await reg.resolveTools();
    expect(tools.map(t => t.name)).toEqual(['mcp_good_search']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('坏服务器'));
    expect(warn.mock.calls.flat().join(' ')).not.toContain('bad.example.com');
  });

  it('缓存命中:第二次 resolveTools 不再发 initialize/list(请求总数不变)', async () => {
    const { fn, requests } = scriptedFetch({ initialize: () => jsonRpc({}), 'tools/list': () => listResp() });
    const reg = new McpRegistry([{ id: 'a', name: 'One', url: 'https://a.example.com', apiKey: '', trust: 'auto' }], fn);
    await reg.resolveTools();
    const count = requests.length;
    const again = await reg.resolveTools();
    expect(requests.length).toBe(count);
    expect(again).toHaveLength(1);
    // 不同 Registry 实例同 key 也命中(模块级缓存)
    const reg2 = new McpRegistry([{ id: 'a', name: 'One', url: 'https://a.example.com', apiKey: '', trust: 'auto' }], fn);
    await reg2.resolveTools();
    expect(requests.length).toBe(count);
  });

  it('execute 走缓存的 client:确认续跑不重握手', async () => {
    const { fn, requests } = scriptedFetch({
      initialize: () => jsonRpc({}, { 'mcp-session-id': 's1' }),
      'tools/list': () => listResp(),
      'tools/call': () => jsonRpc({ content: [{ type: 'text', text: '命中' }] }),
    });
    const reg = new McpRegistry([{ id: 'a', name: 'One', url: 'https://a.example.com', apiKey: '', trust: 'auto' }], fn);
    const tools = await reg.resolveTools();
    const before = requests.length;
    expect(await tools[0].execute(null as never, { q: 'x' })).toBe('命中');
    expect(requests.length).toBe(before + 1);   // 只有 tools/call,无重新握手
  });
});
