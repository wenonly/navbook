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

export interface AiConfig {
  providers: AiProviderConfig[];
  activeProviderId: string | null;
  systemPrompt: string;
}

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
  | { type: 'done'; messageIds: number[] }
  | { type: 'error'; code: number; msg: string };

// ---- on_ai_messages.content 的 JSON 形状(镜像 shared ChatMsgContent) ----
export interface UserMsgContent { text: string }
export interface AssistantMsgContent {
  text: string;
  reasoning: string;
  toolCalls: Array<{ id: string; name: string; args: unknown }>;
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
export type ChatMsgContent = UserMsgContent | AssistantMsgContent | ToolMsgContent;

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
