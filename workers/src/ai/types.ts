// 本文件是 workers 侧的 AI 类型集合。ChatSseEvent / 消息内容 DTO 与
// shared/src/chat/types.ts 是线缆契约的两侧镜像,改一处必改另一处。
import type { DB } from '../db/client';

/** s_ai.providers 条目(存储态,apiKey 明文——先例:SecretKey 存 on_options) */
export interface AiProviderConfig {
  id: string;
  name: string;
  preset: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 远程 MCP 服务器(Streamable HTTP);apiKey 空串 = 不发 Authorization 头(key 拼 URL 的服务器) */
export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  trust: 'confirm' | 'auto';
}

export interface AiConfig {
  providers: AiProviderConfig[];
  activeProviderId: string | null;
  systemPrompt: string;
  mcpServers: McpServerConfig[];
  /** 工具执行策略覆盖(确认口子):key=工具名(内置或 mcp_ 前缀),缺省跟随工具默认/MCP trust */
  toolPolicy?: ToolPolicy;
}

/** 'auto'=直接执行;'confirm'=出确认卡 */
export type ToolPolicy = Record<string, 'auto' | 'confirm'>;

/** 下发给前端的预设厂商(baseUrl/models 自动填充用) */
export interface AiPreset {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
}

// ---- SSE 线缆事件(镜像 shared/src/chat/types.ts ChatSseEvent) ----
export type ChatSseEvent =
  | { type: 'conversation'; cid: number; title: string }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown; danger: 'read' | 'write' }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string; data: unknown }
  | { type: 'confirm_required'; messageId: number; id: string; name: string; args: unknown; summary: string }
  | { type: 'done'; messageIds: number[]; stopped?: boolean }
  | { type: 'error'; code: number; msg: string }
  | { type: 'hello'; running: boolean }        // 仅 /events 重挂流首帧
  | { type: 'resync' };                         // 缓冲超限:前端全量重读 DB

// ---- on_ai_messages.content 的 JSON 形状(镜像 shared ChatMsgContent) ----
export interface UserMsgContent { text: string }
export interface AssistantMsgContent {
  text: string;
  reasoning: string;
  toolCalls: Array<{ id: string; name: string; args: unknown }>;
  /** 渐进落库标记:回合进行中的行;回合结束清除。前端 running 时跳过该行(由事件流呈现) */
  live?: boolean;
  /** 中断标记(停止/网络断/崩溃残留) */
  truncated?: boolean;
}
export type ToolStatus = 'ok' | 'error' | 'pending' | 'rejected';
export interface ToolMsgContent {
  toolCallId: string;
  name: string;
  args: unknown;
  status: ToolStatus;
  summary: string;
  result: unknown;
}
export interface ErrorMsgContent { text: string }
export type ChatMsgContent = UserMsgContent | AssistantMsgContent | ToolMsgContent | ErrorMsgContent;

// ---- Provider 抽象(agent 只见接口,测试注入 Fake) ----
export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  /** DeepSeek 思考模式要求:带 tool_calls 的 assistant 历史消息必须回传,否则 400 */
  reasoning_content?: string;
}

export type ProviderStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; call: { id: string; name: string; args: string } } // 已拼装完整
  | { type: 'finish'; reason: string };

export interface ProviderClient {
  streamChat(p: {
    baseUrl: string; apiKey: string; model: string;
    messages: ProviderMessage[]; tools?: unknown[]; signal?: AbortSignal;
  }): AsyncGenerator<ProviderStreamEvent>;
}

export type WorkerDB = DB;
