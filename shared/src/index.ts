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

  return {
    publicNav: () => get<{ code: 0; data: NavData }>('/api/public_nav').then(r => r.data),
    session: () => get<{ code: 0; data: SessionInfo }>('/api/session'),
    // 未来生长点：search(q) / articles() / themeConfig() ...
  };
}

// ---- AI 聊天(纯 TS,web 与 themes 共用;不依赖任何 UI 框架) ----
export * from './chat/types';
export { parseSseStream } from './chat/sse';
export { ChatMachine } from './chat/machine';
export type { ChatTransport, UiItem, ChatSnapshot } from './chat/machine';
