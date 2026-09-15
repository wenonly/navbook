// 线缆契约(与 workers/src/ai/types.ts 镜像,改一处必改另一处):
// - ChatSseEvent = POST /api/ai_chat 的 SSE 事件
// - ChatMsgContent = on_ai_messages.content 的 JSON 形状
export type ChatSseEvent =
  | { type: 'conversation'; cid: number; title: string }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown; danger: 'read' | 'write' }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string; data: unknown }
  | { type: 'confirm_required'; messageId: number; id: string; name: string; args: unknown; summary: string }
  | { type: 'done'; messageIds: number[] }
  | { type: 'error'; code: number; msg: string };

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

export interface ChatMessageDto {
  id: number;
  role: 'user' | 'assistant' | 'tool';
  content: ChatMsgContent;
  created_at: number;
}

export interface ConversationDto {
  id: number;
  title: string;
  updated_at: number;
}

export interface ChatStreamBody {
  cid: number;
  message?: string;
  confirm?: { message_id: number; action: 'approve' | 'reject' };
}
