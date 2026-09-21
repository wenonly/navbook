// admin SPA 与 API 同源：cookie 由浏览器自动携带（fetch 默认 credentials: 'same-origin'），
// 前端不传 token、不读 cookie（HttpOnly）。

// 后端业务错误统一为 {code:!=0, msg}（zod 校验/重名/删除被拒/401 等），在此抛错；
// 否则调用方会把失败响应当成功处理（fetch 对 401 等也不会 reject）。
async function unwrap<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (json && typeof json === 'object' && 'code' in json && (json as any).code !== 0) {
    throw new Error((json as any).msg || `错误码 ${(json as any).code}`);
  }
  return json;
}

async function post<T = any>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) fd.append(k, String(v));
  }
  const res = await fetch(`/api/${method}`, { method: 'POST', body: fd });
  return unwrap<T>(res);
}

async function get<T = any>(path: string): Promise<T> {
  const res = await fetch(path);
  return unwrap<T>(res);
}

async function postJson<T = any>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

export const api = {
  init: (username: string, password: string) => post('init', { username, password }),
  login: (password: string) => post('login', { password }),
  logout: () => post('logout'),
  session: () => get<{ code: number; data: { username: string | null } }>('/api/session'),

  // 后端从 URL query 读 page/limit（上限 100）、从 body 读 category_id
  listCategories: (page = 1, limit = 100) => post(`category_list?page=${page}&limit=${limit}`),
  addCategory: (data: Record<string, unknown>) => post('add_category', data),
  editCategory: (data: Record<string, unknown>) => post('edit_category', data),
  delCategory: (id: number) => post('del_category', { id }),

  // 后端从 URL query 读 page/limit（上限 100），从 body 读筛选：category_id/keyword/property
  listLinks: (
    page = 1,
    limit = 100,
    filters: { category_id?: number; keyword?: string; property?: number } = {},
  ) => post(`link_list?page=${page}&limit=${limit}`, filters),
  addLink: (data: Record<string, unknown>) => post('add_link', data),
  editLink: (data: Record<string, unknown>) => post('edit_link', data),
  delLink: (id: number) => post('del_link', { id }),

  exportJson: () => post('export_json'),
  importJson: (payload: unknown) => postJson('/api/import_json', payload),

  themes: <T = any>() => get<T>('/api/themes'),
  setTheme: (theme: string) => post<{ code: number; data: unknown }>('set_theme', { theme }),

  siteConfig: () => get('/api/site_config'),
  setSite: (data: Record<string, unknown>) => post('set_site', data),

  tokenInfo: () => get('/api/token_info'),
  createSk: () => post('create_sk'),

  // AI 助手
  aiConfig: () => get('/api/ai_config'),
  saveAiConfig: (payload: unknown) => postJson('/api/ai_config', payload),
  aiConversations: () => get('/api/ai_conversations'),
  delAiConversation: (id: number) => post('ai_del_conversation', { id }),
  aiMessages: (cid: number) => get(`/api/ai_messages?cid=${cid}`),
  aiStop: (cid: number) => post('ai_stop', { cid }),
  opLogs: (page = 1, limit = 30) => get(`/api/op_logs?page=${page}&limit=${limit}`),
};
