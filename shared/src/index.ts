// ---- 数据契约（public_nav 会话感知版；兼容承诺：只加字段不删不改语义）----

export interface NavLink {
  id: number;
  fid: number;
  title: string;
  url: string;
  description: string | null;
  font_icon: string | null;
  url_standby: string | null;
  private: boolean;
}
export interface NavCategory {
  id: number;
  name: string;
  font_icon: string | null;
  description: string | null;
  private: boolean;
  children: NavCategory[];
  links: NavLink[];
}
export interface NavData {
  site_title: string;
  site_subtitle: string;
  categories: NavCategory[];
}
export interface SessionInfo {
  username: string | null;
}

// ---- 主题清单（aggregate 生成的 manifest.json 条目）----

export interface ThemeManifestEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  minAppVersion: string;
}

// ---- 错误 ----

export class ApiError extends Error {
  readonly status: number;
  readonly code: number;
  constructor(status: number, code: number, msg: string) {
    super(msg);
    this.status = status;
    this.code = code;
    this.name = 'ApiError';
  }
}

// ---- API client（纯 fetch，同源零配置；401 默认跳登录）----

import { parseSseStream } from './chat/sse';
import type { ChatMessageDto, ChatSseEvent, ChatStreamBody, ConversationDto } from './chat/types';

export interface ApiClientOptions {
  /** 401 时的行为；默认跳转 /admin/login?redirect=<当前路径>，传 false 关闭 */
  onUnauthorized?: ((err: ApiError) => void) | false;
}

export function createApiClient(_opts: ApiClientOptions = {}) {
  const handle401 = (err: ApiError) => {
    if (_opts.onUnauthorized === false) return;
    if (typeof _opts.onUnauthorized === 'function') { _opts.onUnauthorized(err); return; }
    const redirect = encodeURIComponent(location.pathname + location.search);
    location.href = `/admin/login?redirect=${redirect}`;
  };

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(path); // 同源 cookie 自动携带
    const json = await res.json().catch(() => { throw new ApiError(res.status, -1, '响应不是 JSON'); });
    if (res.status === 401) {
      const err = new ApiError(401, json?.code ?? -1002, json?.msg ?? '未登录');
      handle401(err);
      throw err;
    }
    if (json && typeof json === 'object' && 'code' in json && json.code !== 0) {
      throw new ApiError(res.status, json.code, json.msg ?? `错误码 ${json.code}`);
    }
    return json as T;
  }

  // FormData POST(与 workers 端点习惯一致;AI 会话删除等主题端写操作用)
  async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    const fd = new FormData();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) fd.append(k, String(v));
    }
    const res = await fetch(path, { method: 'POST', body: fd });
    const json = await res.json().catch(() => { throw new ApiError(res.status, -1, '响应不是 JSON'); });
    if (res.status === 401) {
      const err = new ApiError(401, json?.code ?? -1002, json?.msg ?? '未登录');
      handle401(err);
      throw err;
    }
    if (json && typeof json === 'object' && 'code' in json && json.code !== 0) {
      throw new ApiError(res.status, json.code, json.msg ?? `错误码 ${json.code}`);
    }
    return json as T;
  }

  // SSE:鉴权失败在流开始前是普通 401 JSON(端点设计如此)
  async function* streamChat(
    body: ChatStreamBody, signal?: AbortSignal,
  ): AsyncGenerator<ChatSseEvent> {
    const fd = new FormData();
    fd.append('cid', String(body.cid));
    if (body.message !== undefined) fd.append('message', body.message);
    if (body.confirm) {
      fd.append('confirm_message_id', String(body.confirm.message_id));
      fd.append('confirm_action', body.confirm.action);
    }
    const res = await fetch('/api/ai_chat', { method: 'POST', body: fd, signal });
    if (res.status === 401) {
      const err = new ApiError(401, -1002, '未登录');
      handle401(err);
      throw err;
    }
    if (!res.ok || !res.body) throw new ApiError(res.status, -1, `AI 服务异常(HTTP ${res.status})`);
    for await (const { event, data } of parseSseStream(res.body)) {
      if (event === 'hb') continue;
      yield JSON.parse(data) as ChatSseEvent;
    }
  }

  return {
    publicNav: () => get<{ code: 0; data: NavData }>('/api/public_nav').then(r => r.data),
    session: () => get<{ code: 0; data: SessionInfo }>('/api/session'),
    aiConversations: () => get<{ code: 0; data: ConversationDto[] }>('/api/ai_conversations'),
    aiMessages: (cid: number) => get<{ code: 0; data: ChatMessageDto[] }>(`/api/ai_messages?cid=${cid}`),
    delAiConversation: (id: number) => post('/api/ai_del_conversation', { id }),
    streamChat,
  };
}

// ---- AI 聊天(纯 TS,web 与 themes 共用;不依赖任何 UI 框架) ----
export * from './chat/types';
export { parseSseStream } from './chat/sse';
export { ChatMachine, blockedReason, activityLabel } from './chat/machine';
export type { ChatTransport, UiItem, ChatSnapshot } from './chat/machine';
