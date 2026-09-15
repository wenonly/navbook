import { describe, it, expect } from 'vitest';
import { OpenAiCompatProvider, ProviderError } from '../../src/ai/provider';
import type { ProviderStreamEvent } from '../../src/ai/types';

const enc = new TextEncoder();
function sseResponse(lines: string[], status = 200): Response {
  const body = lines.join('\n') + '\n';
  return new Response(enc.encode(body), {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}
async function collect(gen: AsyncGenerator<ProviderStreamEvent>) {
  const out: ProviderStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}
const ARGS = { baseUrl: 'https://fake/v1', apiKey: 'sk-x', model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] };

describe('OpenAiCompatProvider', () => {
  it('纯文本流 + finish', async () => {
    const p = new OpenAiCompatProvider(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":"好"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ]));
    const out = await collect(p.streamChat(ARGS));
    expect(out).toEqual([
      { type: 'text', delta: '你' },
      { type: 'text', delta: '好' },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('reasoning_content 走 reasoning 事件(DeepSeek/Qwen 思考模型)', async () => {
    const p = new OpenAiCompatProvider(async () => sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"思考中"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":"答案"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ]));
    const out = await collect(p.streamChat(ARGS));
    expect(out[0]).toEqual({ type: 'reasoning', delta: '思考中' });
    expect(out[1]).toEqual({ type: 'text', delta: '答案' });
  });

  it('tool_calls 分片到达:id/name 首片、arguments 逐片拼接,流末输出拼装完整调用', async () => {
    const p = new OpenAiCompatProvider(async () => sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search_links","arguments":""}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"key"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"word\\":\\"gi\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ]));
    const out = await collect(p.streamChat(ARGS));
    expect(out).toEqual([
      { type: 'tool_call', call: { id: 'call_1', name: 'search_links', args: '{"keyword":"gi"}' } },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });

  it('HTTP 401 → ProviderError 带可读文案', async () => {
    const p = new OpenAiCompatProvider(async () => new Response('{"error":"bad key"}', { status: 401 }));
    await expect(collect(p.streamChat(ARGS))).rejects.toSatisfy((e: unknown) =>
      e instanceof ProviderError && e.status === 401 && (e as ProviderError).message.includes('API Key'));
  });

  it('请求体含 tools 与 stream:true,鉴权头 Bearer', async () => {
    let captured!: Request;
    const p = new OpenAiCompatProvider(async (req: RequestInfo, init?: RequestInit) => {
      captured = new Request(req, init);
      return sseResponse(['data: [DONE]']);
    });
    await collect(p.streamChat({ ...ARGS, tools: [{ type: 'function', function: { name: 'x', parameters: {} } }] }));
    expect(captured.url).toBe('https://fake/v1/chat/completions');
    expect(captured.headers.get('authorization')).toBe('Bearer sk-x');
    const body: any = await captured.json();
    expect(body.stream).toBe(true);
    expect(body.tools).toHaveLength(1);
  });
});
