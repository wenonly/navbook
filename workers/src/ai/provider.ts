// OpenAI 兼容 /chat/completions 流式客户端。只认识协议,不认识业务工具;
// fetch 可注入(测试 fixture)。tool_calls 分片在流末统一拼装输出。
import type { ProviderClient, ProviderMessage, ProviderStreamEvent } from './types';

export class ProviderError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

function classifyHttpError(status: number, body: string): string {
  if (status === 401) return 'API Key 无效,请到「模型配置」检查';
  if (status === 402) return '厂商账户余额不足,请到厂商控制台充值';
  if (status === 403) return '厂商拒绝访问(403),请检查 Key 权限或 IP 白名单';
  if (status === 429) return '请求过于频繁(厂商限流),请稍后再试';
  const detail = body.slice(0, 200).replace(/\s+/g, ' ').trim();
  return `厂商接口错误(HTTP ${status})${detail ? ':' + detail : ''}`;
}

export class OpenAiCompatProvider implements ProviderClient {
  constructor(private fetchFn: typeof fetch = fetch) {}

  async *streamChat(p: {
    baseUrl: string; apiKey: string; model: string;
    messages: ProviderMessage[]; tools?: unknown[]; signal?: AbortSignal;
  }): AsyncGenerator<ProviderStreamEvent> {
    const res = await this.fetchFn(`${p.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({
        model: p.model,
        messages: p.messages,
        tools: p.tools?.length ? p.tools : undefined,
        stream: true,
      }),
      signal: p.signal,
    });
    if (!res.ok || !res.body) {
      const errBody = await res.text().catch(() => '');
      throw new ProviderError(res.status, classifyHttpError(res.status, errBody));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    // OpenAI 兼容流:tool_calls 分片到达(index 定位,id/name 首片给出,arguments 逐片累加)
    const pendingToolCalls: Array<{ id: string; name: string; args: string } | undefined> = [];
    let finishReason = '';

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;   // 注释行/event 行等忽略(厂商单行 data)
        const data = line.slice(5).trim();
        if (data === '[DONE]') break outer;
        let chunk: any;
        try { chunk = JSON.parse(data); } catch { continue; }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (typeof delta.content === 'string' && delta.content) yield { type: 'text', delta: delta.content };
        // 思考流:DeepSeek reasoning_content;部分厂商叫 reasoning
        const rc = delta.reasoning_content ?? delta.reasoning;
        if (typeof rc === 'string' && rc) yield { type: 'reasoning', delta: rc };
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const i = typeof tc.index === 'number' ? tc.index : 0;
            pendingToolCalls[i] ??= { id: '', name: '', args: '' };
            if (tc.id) pendingToolCalls[i]!.id = tc.id;
            if (tc.function?.name) pendingToolCalls[i]!.name = tc.function.name;
            if (tc.function?.arguments) pendingToolCalls[i]!.args += tc.function.arguments;
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    }
    for (const c of pendingToolCalls) {
      if (c && (c.id || c.name)) yield { type: 'tool_call', call: c };
    }
    yield { type: 'finish', reason: finishReason || 'stop' };
  }
}
