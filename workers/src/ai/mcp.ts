// 远程 MCP 接入(Streamable HTTP,协议版本 2025-03-26)。
// McpClient = 最小 JSON-RPC 客户端(initialize/tools/list/tools/call,双形态响应解析);
// McpRegistry = 工具发现 + 模块级缓存 + AiTool 包装。
// 安全约束:错误信息与日志绝不包含 URL 与 apiKey——URL 里可能嵌着密钥(Tavily)。
import type { AiTool } from './tools';
import type { McpServerConfig } from './types';

const PROTOCOL_VERSION = '2025-03-26';
const LIST_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 40_000;
const MAX_TOOLS_PER_SERVER = 20;
const RESULT_MAX_CHARS = 16 * 1024;
const NAME_MAX = 64;

export class McpError extends Error {
  constructor(msg: string) { super(msg); }
}

/** JSON-RPC 自增 id(notification 不带 id,不发这条路径) */
let reqSeq = 0;

function firstLine(s: string, n: number): string {
  return String(s).split('\n')[0]?.slice(0, n) ?? '';
}

/** SSE 帧行缓冲:取首个含 result/error 的 JSON-RPC 帧,忽略注释与通知帧;读完 cancel 释放连接 */
async function readFirstRpcFrame(body: ReadableStream<Uint8Array>, serverName: string): Promise<any> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try {
          const m = JSON.parse(data);
          if (m && typeof m === 'object' && ('result' in m || 'error' in m)) return m;
        } catch { /* 坏帧跳过 */ }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new McpError(`MCP 服务器(${serverName})SSE 流中没有 JSON-RPC 响应`);
}

function flattenContent(result: any): string {
  const parts: string[] = [];
  if (Array.isArray(result?.content)) {
    for (const c of result.content) {
      if (c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
      else parts.push(`[${c?.type ?? 'unknown'} 内容]`);
    }
  }
  if (parts.length) return parts.join('\n');
  if (result?.structuredContent != null) return JSON.stringify(result.structuredContent);
  return '';
}

export interface McpClientTimeouts { list?: number; call?: number }

export class McpClient {
  sessionId: string | null = null;

  constructor(
    private server: McpServerConfig,
    private fetchFn: typeof fetch = fetch.bind(globalThis),
    private timeouts: McpClientTimeouts = {},
  ) {}

  /** 单条 JSON-RPC POST;返回 {响应消息, HTTP Response}(session 头在 HTTP 头里) */
  private async rpcRaw(method: string, params: unknown, timeoutMs: number): Promise<{ msg: any; res: Response }> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_VERSION,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (this.server.apiKey) headers.authorization = `Bearer ${this.server.apiKey}`;

    let res: Response;
    try {
      res = await this.fetchFn(this.server.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: ++reqSeq, method, ...(params !== undefined ? { params } : {}) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new McpError(`MCP 服务器(${this.server.name})超时,请稍后重试`);
      }
      throw new McpError(`MCP 服务器(${this.server.name})不可达`);
    }
    if (!res.ok) throw new McpError(`MCP 服务器(${this.server.name})响应 HTTP ${res.status}`);

    const ct = res.headers.get('content-type') ?? '';
    let msg: any;
    if (ct.includes('text/event-stream') && res.body) {
      msg = await readFirstRpcFrame(res.body, this.server.name);
    } else {
      msg = await res.json().catch(() => {
        throw new McpError(`MCP 服务器(${this.server.name})响应不是 JSON`);
      });
    }
    if (!msg || typeof msg !== 'object') throw new McpError(`MCP 服务器(${this.server.name})响应格式异常`);
    if ('error' in msg && msg.error) {
      throw new McpError(`MCP 服务器(${this.server.name})错误 ${msg.error.code ?? ''}:${msg.error.message ?? ''}`);
    }
    return { msg, res };
  }

  private async rpc(method: string, params: unknown, timeoutMs: number): Promise<any> {
    return (await this.rpcRaw(method, params, timeoutMs)).msg.result;
  }

  /** 尽力而为握手:捕获响应头 mcp-session-id(无 = 无状态服务器);失败不 fatal */
  async initialize(): Promise<void> {
    try {
      const { res } = await this.rpcRaw('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'navbook-ai', version: '1.0' },
      }, this.timeouts.list ?? LIST_TIMEOUT_MS);
      this.sessionId = res.headers.get('mcp-session-id');
      // 有状态服务器才发 initialized 通知(无状态服务器发了也是浪费子请求;错误一律吞)
      if (this.sessionId) {
        try {
          await this.fetchFn(this.server.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              'mcp-protocol-version': PROTOCOL_VERSION,
              'mcp-session-id': this.sessionId,
              ...(this.server.apiKey ? { authorization: `Bearer ${this.server.apiKey}` } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
            signal: AbortSignal.timeout(this.timeouts.list ?? LIST_TIMEOUT_MS),
          });
        } catch { /* 202/失败都吞 */ }
      }
    } catch {
      // 无状态服务器(Tavily)initialize 可失败仍可用,后续 listTools 自行成败
    }
  }

  /** cursor 分页,封顶 20 个;inputSchema 非对象兜底 {type:'object'} */
  async listTools(): Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>> {
    const out: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];
    let cursor: string | undefined;
    do {
      const result = await this.rpc('tools/list', cursor ? { cursor } : {}, this.timeouts.list ?? LIST_TIMEOUT_MS);
      for (const t of Array.isArray(result?.tools) ? result.tools : []) {
        if (!t || typeof t?.name !== 'string' || !t.name) continue;
        out.push({
          name: t.name,
          description: typeof t.description === 'string' ? t.description : '',
          inputSchema: t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
            ? t.inputSchema
            : { type: 'object' },
        });
        if (out.length >= MAX_TOOLS_PER_SERVER) return out;
      }
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined;
    } while (cursor);
    return out;
  }

  /** isError → throw;content 拍平;structuredContent 兜底;截断 16K 字符 */
  async callTool(name: string, args: unknown): Promise<unknown> {
    const result = await this.rpc('tools/call', { name, arguments: args ?? {} }, this.timeouts.call ?? CALL_TIMEOUT_MS);
    const text = flattenContent(result);
    if (result?.isError) throw new McpError(`MCP 工具返回错误:${firstLine(text, 200)}`);
    if (text.length > RESULT_MAX_CHARS) return `${text.slice(0, RESULT_MAX_CHARS)}\n…(结果过长已截断)`;
    return text;
  }
}

// ---- Registry:发现 + 缓存 + 包装 ----

const CACHE_TTL_MS = 10 * 60 * 1000;
/** 模块级缓存:isolate 内跨请求复用,稳态回合零发现开销(Free 版 50 子请求/次预算) */
const cache = new Map<string, { tools: AiTool[]; fetchedAt: number }>();

/** 测试专用:清空模块级缓存 */
export function resetMcpCache() {
  cache.clear();
}

/** OpenAI function name 只许 [a-zA-Z0-9_-];中文/特殊字符清洗后小写,空名由调用方回落 */
function slug(s: string): string {
  return String(s).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, 40);
}

function wrapTools(server: McpServerConfig, client: McpClient, list: Awaited<ReturnType<McpClient['listTools']>>): AiTool[] {
  const srv = slug(server.name) || 'srv';
  const danger: AiTool['danger'] = server.trust === 'auto' ? 'read' : 'write';
  return list.map(t => ({
    // 基名截到 61,给 _N 去重后缀留空间(总长 ≤64)
    name: `mcp_${srv}_${slug(t.name) || 'tool'}`.slice(0, NAME_MAX - 3),
    description: `[MCP:${server.name}] ${t.description || '外部工具'}`,
    parameters: t.inputSchema,
    danger,
    summarize: (_args: Record<string, any>, result: unknown) => result === null || result === undefined
      ? `调用外部工具 ${t.name}(${server.name})`
      : `调用 ${t.name}(${server.name}):${firstLine(String(result), 80)}`,
    execute: (_db, args) => client.callTool(t.name, args),
  }));
}

export class McpRegistry {
  constructor(
    private servers: McpServerConfig[],
    private fetchFn: typeof fetch = fetch.bind(globalThis),
  ) {}

  async resolveTools(): Promise<AiTool[]> {
    const results = await Promise.allSettled(this.servers.map(async server => {
      const key = `${server.id}:${server.url}:${server.apiKey.length}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.tools;
      const client = new McpClient(server, this.fetchFn);
      await client.initialize();
      const tools = wrapTools(server, client, await client.listTools());
      cache.set(key, { tools, fetchedAt: Date.now() });
      return tools;
    }));
    const out: AiTool[] = [];
    const used = new Set<string>();
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        // 仅名称,绝不带 URL/key
        console.warn(`[mcp] ${this.servers[i].name} 工具发现失败:${r.reason instanceof Error ? r.reason.message : '未知错误'}`);
        continue;
      }
      for (const t of r.value) {
        let name = t.name;
        let n = 2;
        while (used.has(name)) name = `${t.name}_${n++}`;   // 基名已留 3 字符后缀空间
        used.add(name);
        out.push(name === t.name ? t : { ...t, name });
      }
    }
    return out;
  }
}
