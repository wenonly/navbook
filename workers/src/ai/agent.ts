// ReAct 循环编排:Reason(模型文本/思考流)→ Act(tool_call)→ Observe(tool result 喂回)。
// 通过 emit 回调输出线缆事件,不碰 HTTP/SSE(路由层负责);provider 走接口,测试注入 Fake。
import type {
  AiConfig, ChatSseEvent, ProviderClient, ProviderMessage, ToolMsgContent, WorkerDB,
} from './types';
import { resolveActiveProvider } from './config';
import { findTool, toolSpecs } from './tools';
import {
  createConversation, insertMessage, listMessages, countMessages, updateMessageContent,
} from './conversations';
import type { AiTool } from './tools';

/** MCP 工具注入(结构化最小接口;McpRegistry 结构满足,测试可注入 Fake) */
export interface AgentMcp {
  resolveTools(): Promise<AiTool[]>;
}

export const MAX_STEPS = 8;
export const CONTEXT_MESSAGES = 50;
export const MAX_CONVERSATION_MESSAGES = 500;
export const TURN_TIMEOUT_MS = 180_000;

export const DEFAULT_SYSTEM_PROMPT = [
  '你是 NavBook 书签导航站的 AI 助手,管理员通过对话让你管理站内数据。',
  '可用能力:搜索/查看链接与分类、点击统计、站点设置,以及新增/修改/删除链接和分类,抓取任意网页内容(fetch_url)。',
  '原则:涉及数据的问题先用工具查询再回答,不确定时调 list_categories 确认 id;',
  '写操作(新增/修改/删除)会请求用户确认,被拒绝时如实告知,不要重复发起同一被拒操作;',
  '同一回合需执行 2 项及以上写操作时,优先用 batch_write 一次提交(共享一张确认卡,最多 20 项);单项写操作仍用对应单工具;',
  '回答用简体中文,简洁直接。',
].join('\n');

export interface AgentDeps {
  db: WorkerDB;
  provider: ProviderClient;
  /** 缺省 = 无 MCP(现状行为逐字节一致) */
  mcp?: AgentMcp;
}

export interface AgentTurnOptions {
  conversationId: number;            // 0 = 新建会话
  message?: string;
  /** 写工具确认(Task 13);approve 执行并续跑循环,reject 记拒绝并续跑 */
  confirm?: { messageId: number; action: 'approve' | 'reject' };
  emit: (ev: ChatSseEvent) => Promise<void>;
  signal?: AbortSignal;
}

export async function runAgentTurn(deps: AgentDeps, cfg: AiConfig, opts: AgentTurnOptions): Promise<void> {
  const { db, provider } = deps;
  const emit = opts.emit;

  const fail = async (msg: string) => { await emit({ type: 'error', code: -2000, msg }); };

  const active = resolveActiveProvider(cfg);
  if (!active) return fail('尚未配置可用的模型厂商,请到后台「AI 助手 → 模型配置」添加');

  // 新会话:先建库再发 conversation 事件(前端靠它拿到 cid)
  let cid = opts.conversationId;
  if (!cid) {
    const conv = await createConversation(db, '');
    cid = conv.id;
    await emit({ type: 'conversation', cid, title: '' });
  }

  // ---- MCP 工具解析:必须在 confirm 块之前(确认续跑是全新 HTTP 请求,
  // approve 时需要已解析好的 wrapper 才能执行工具;缓存命中时此处零网络开销) ----
  const mcpTools = deps.mcp ? await deps.mcp.resolveTools() : [];
  const mcpByName = new Map(mcpTools.map(t => [t.name, t]));
  const resolveTool = (name: string): AiTool | undefined => findTool(name) ?? mcpByName.get(name);
  const tools = [
    ...toolSpecs(),
    ...mcpTools.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
  ];
  const systemPrompt = (cfg.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT)
    + (mcpTools.length ? '\n另有外部工具(名称 mcp_ 前缀)来自 MCP 服务器,按其描述与参数调用;失败或为空时如实告知。' : '');

  // ---- 写工具确认恢复:执行/拒绝后带着结果继续循环 ----
  if (opts.confirm) {
    const msgs = await listMessages(db, cid);
    const msg = msgs.find(m => m.id === opts.confirm!.messageId);
    const c = msg?.content as any;
    if (msg?.role !== 'tool' || c?.status !== 'pending') {
      return fail('确认目标不存在或已处理,请重新发起');
    }
    const tool = resolveTool(c.name);
    if (opts.confirm.action === 'approve' && tool) {
      const { content } = await execTool(db, tool, { id: c.toolCallId, name: c.name, args: c.args });
      await updateMessageContent(db, msg.id, content);
      await emit({
        type: 'tool_result', id: content.toolCallId, name: content.name,
        ok: content.status === 'ok', summary: content.summary, data: content.result,
      });
    } else {
      const content: ToolMsgContent = {
        ...c, status: 'rejected', summary: '用户取消了该操作',
        result: { code: -2000, msg: '用户取消了该操作' },
      };
      await updateMessageContent(db, msg.id, content);
      await emit({
        type: 'tool_result', id: c.toolCallId, name: c.name,
        ok: false, summary: content.summary, data: content.result,
      });
    }
  }

  if (opts.message !== undefined) {
    if (await countMessages(db, cid) >= MAX_CONVERSATION_MESSAGES) {
      return fail(`会话消息数已达上限(${MAX_CONVERSATION_MESSAGES}),请新建会话`);
    }
    await insertMessage(db, cid, 'user', { text: opts.message });
  }

  const messageIds: number[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    if (opts.signal?.aborted) return;
    // ---- 组装上下文(最近 50 条映射为 OpenAI 消息) ----
    const history = (await listMessages(db, cid)).slice(-CONTEXT_MESSAGES);
    const messages: ProviderMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(m => toProviderMessage(m.id, m.role, m.content)),
    ];

    // ---- 流式调用厂商,转发 delta/reasoning ----
    let text = '';
    let reasoning = '';
    const toolCalls: Array<{ id: string; name: string; args: unknown }> = [];
    try {
      for await (const ev of provider.streamChat({
        baseUrl: active.baseUrl, apiKey: active.apiKey, model: active.model,
        messages, tools, signal: opts.signal,
      })) {
        if (ev.type === 'text') { text += ev.delta; await emit({ type: 'delta', text: ev.delta }); }
        else if (ev.type === 'reasoning') { reasoning += ev.delta; await emit({ type: 'reasoning', text: ev.delta }); }
        else if (ev.type === 'tool_call') {
          let args: unknown = {};
          try { args = JSON.parse(ev.call.args || '{}'); } catch { args = { _raw: ev.call.args }; }
          toolCalls.push({ id: ev.call.id || `call_${step}_${toolCalls.length}`, name: ev.call.name, args });
        }
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : '厂商请求失败');
    }

    // ---- assistant 消息落库(ReAct:中间推理也是消息,历史即思考链) ----
    const assistantMsg = await insertMessage(db, cid, 'assistant', { text, reasoning, toolCalls });
    messageIds.push(assistantMsg.id);

    if (toolCalls.length === 0) {
      await emit({ type: 'done', messageIds });
      return;
    }

    // ---- 执行工具:读直接执行;写走确认流(本轮流终止,前端确认后恢复) ----
    let needConfirm = false;
    for (const call of toolCalls) {
      const tool = resolveTool(call.name);
      const danger = tool?.danger ?? 'read';
      await emit({ type: 'tool_call', id: call.id, name: call.name, args: call.args, danger });

      if (!tool) {
        await persistToolResult(db, cid, emit, messageIds, {
          toolCallId: call.id, name: call.name, args: call.args,
          status: 'error', summary: `未知工具:${call.name}`, result: { code: -2000, msg: '未知工具' },
        });
        continue;
      }
      if (tool.danger === 'write') {
        needConfirm = true;
        await persistToolResult(db, cid, emit, messageIds, {
          toolCallId: call.id, name: call.name, args: call.args,
          status: 'pending', summary: tool.summarize((call.args ?? {}) as Record<string, any>, null), result: null,
        }, true);
        continue;
      }
      const { content } = await execTool(db, tool, call);
      await persistToolResult(db, cid, emit, messageIds, content, false);
    }
    if (needConfirm) {   // 有一张确认卡即终止本轮(前端确认后恢复)
      await emit({ type: 'done', messageIds });
      return;
    }
    // 全是读工具 → 结果已在库,进入下一轮(Observe)
  }
  await fail(`已达最大工具调用步数(${MAX_STEPS}),请简化请求或拆分操作`);
}

// ---- 工具执行(读/确认后的写):异常/业务错误都转成"错误 tool 结果",喂回模型自愈 ----
async function execTool(
  db: WorkerDB, tool: AiTool,
  call: { id: string; name: string; args: unknown },
): Promise<{ content: ToolMsgContent; ok: boolean }> {
  const args = (call.args ?? {}) as Record<string, any>;
  try {
    const result = await tool.execute(db, args);
    const ok = !(result && typeof result === 'object' && 'code' in result && (result as any).code !== 0);
    const content: ToolMsgContent = {
      toolCallId: call.id, name: call.name, args,
      status: ok ? 'ok' : 'error',
      summary: tool.summarize(args, result),
      result,
    };
    return { content, ok };
  } catch (e) {
    return {
      content: {
        toolCallId: call.id, name: call.name, args,
        status: 'error' as const,
        summary: `${tool.summarize(args, null)} 失败:${e instanceof Error ? e.message : '未知错误'}`,
        result: { code: -2000, msg: e instanceof Error ? e.message : '执行异常' },
      },
      ok: false,
    };
  }
}

async function persistToolResult(
  db: WorkerDB, cid: number,
  emit: (ev: ChatSseEvent) => Promise<void>,
  messageIds: number[],
  content: ToolMsgContent,
  pending = false,
) {
  const msg = await insertMessage(db, cid, 'tool', content);
  messageIds.push(msg.id);
  if (pending) {
    await emit({
      type: 'confirm_required', messageId: msg.id,
      id: content.toolCallId, name: content.name, args: content.args, summary: content.summary,
    });
  } else {
    await emit({
      type: 'tool_result', id: content.toolCallId, name: content.name,
      ok: content.status === 'ok', summary: content.summary, data: content.result,
    });
  }
}

// ---- 历史消息 → OpenAI wire 消息 ----
function toProviderMessage(id: number, role: 'user' | 'assistant' | 'tool', content: unknown): ProviderMessage {
  void id;
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
