// 上下文组装:库内历史 → 合法的 OpenAI wire 消息(单一职责,可独立测试)。
// 三步:窗口切割(边界对齐 tool 消息组)→ 逐条映射 → 合法性防线(孤儿 tool 丢弃/不完整 calls 剥离)。
import type { ChatMsgContent, ProviderMessage } from './types';
import type { ChatMessageDto } from './conversations';

export const CONTEXT_LIMIT = 50;

/** 窗口起点不得落在 tool 消息上——tool 必须连同其 assistant(tool_calls) 父消息一起进窗口,
 * 否则厂商 400("Messages with role 'tool' must be a response to a preceding message with 'tool_calls'")。
 * 回扩后窗口可能比 limit 多几条:合法性优先于条数上限。 */
function cutContextWindow(history: ChatMessageDto[], limit: number): ChatMessageDto[] {
  let start = Math.max(0, history.length - limit);
  while (start > 0 && history[start].role === 'tool') start--;                    // 回扩到父 assistant
  while (start < history.length && history[start].role === 'tool') start++;       // 兜底:历史本身以孤儿 tool 开头 → 丢弃
  return history.slice(start);
}

/** 防线(异常数据/中断残留):孤儿 tool 丢弃;应答不完整的 assistant 剥 tool_calls 降级为普通消息 */
function sanitizeProviderMessages(msgs: ProviderMessage[]): ProviderMessage[] {
  const keepToolIdx = new Set<number>();
  const stripIdx = new Set<number>();
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== 'assistant' || !m.tool_calls?.length) continue;
    const need = new Set(m.tool_calls.map(c => c.id));
    let j = i + 1;
    while (j < msgs.length && msgs[j].role === 'tool') {
      if (need.delete(msgs[j].tool_call_id ?? '')) keepToolIdx.add(j);
      j++;
    }
    if (need.size > 0) {
      stripIdx.add(i);
      for (let k = i + 1; k < j; k++) keepToolIdx.delete(k);   // 半套应答不能留(会变成新孤儿)
    }
  }
  const out: ProviderMessage[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'tool' && !keepToolIdx.has(i)) continue;
    if (stripIdx.has(i)) {
      out.push({ role: 'assistant', content: m.content ?? '(工具调用未完成,已跳过)' });
      continue;
    }
    out.push(m);
  }
  return out;
}

function toProviderMessage(role: 'user' | 'assistant' | 'tool', content: ChatMsgContent | unknown): ProviderMessage {
  const c = content as any;
  if (role === 'user') return { role: 'user', content: String(c?.text ?? '') };
  if (role === 'assistant') {
    const calls = Array.isArray(c?.toolCalls) && c.toolCalls.length
      ? c.toolCalls.map((t: any) => ({
          id: String(t.id), type: 'function' as const,
          function: { name: String(t.name), arguments: JSON.stringify(t.args ?? {}) },
        }))
      : undefined;
    return {
      role: 'assistant', content: c?.text || null,
      ...(calls ? { tool_calls: calls } : {}),
      // DeepSeek 思考模式:带 tool_calls 的 assistant 消息必须回传 reasoning_content,否则
      // 400 "The reasoning_content in the thinking mode must be passed back to the API"
      ...(calls && c?.reasoning ? { reasoning_content: c.reasoning } : {}),
    };
  }
  return {
    role: 'tool',
    tool_call_id: String(c?.toolCallId ?? ''),
    content: JSON.stringify({ status: c?.status, summary: c?.summary, result: c?.result }),
  };
}

/** 唯一入口:库内完整历史 → [system + 合法 wire 消息] */
export function assembleProviderMessages(history: ChatMessageDto[], systemPrompt: string): ProviderMessage[] {
  // error 行是展示产物(UI 红条),不进厂商上下文
  const usable = history.filter((m): m is ChatMessageDto & { role: 'user' | 'assistant' | 'tool' } => m.role !== 'error');
  const win = cutContextWindow(usable, CONTEXT_LIMIT);
  return [
    { role: 'system', content: systemPrompt },
    ...sanitizeProviderMessages(win.map(m => toProviderMessage(m.role as 'user' | 'assistant' | 'tool', m.content))),
  ];
}
