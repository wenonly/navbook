// 工具注册表:execute 直调 handlers/* 纯函数(权限天然=管理员,业务校验/转义全复用)。
// 不知道 provider/agent 的存在;新增工具=加一个条目。
import { eq, gt, desc, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { ToolPolicy, WorkerDB } from './types';
import {
  linkListHandler, getALinkHandler, addLinkHandler, editLinkHandler, delLinkHandler,
} from '../handlers/link';
import {
  categoryListHandler, getACategoryHandler,
  addCategoryHandler, editCategoryHandler, delCategoryHandler,
} from '../handlers/category';
import { getSiteConfig, siteConfigData } from '../handlers/site';
import { fetchAndExtract } from './fetcher';
import { saveMemory, MEMORY_MAX_CHARS } from './memory';

export interface AiTool {
  name: string;
  description: string;                 // 给模型看的中文说明
  parameters: Record<string, unknown>; // JSON Schema(OpenAI function calling)
  danger: 'read' | 'write';
  /** 默认执行策略(缺省按 danger 推导);如 memory_write 语义是写但默认免确认 */
  defaultPolicy?: 'auto' | 'confirm';
  /** 确认卡(执行前 result=null)与结果卡(执行后)的中文文案,后端生成前端照渲染 */
  summarize(args: Record<string, any>, result: unknown): string;
  execute(db: WorkerDB, args: Record<string, any>): Promise<unknown>;
}

const int = (v: unknown, dflt = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

export const AI_TOOLS: AiTool[] = [
  {
    name: 'search_links',
    description: '按关键词/分类/属性搜索站内链接。关键词模糊匹配标题、URL、描述。返回分页结果(最多20条)。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词,可选' },
        category_id: { type: 'number', description: '限定分类 id,可选' },
        property: { type: 'number', enum: [0, 1], description: '0=公开 1=私密,可选' },
      },
    },
    danger: 'read',
    summarize: (a, r) => r && typeof r === 'object' && 'count' in r
      ? `搜索${a.keyword ? `「${a.keyword}」` : '链接'}:${(r as any).count} 条结果`
      : `搜索链接${a.keyword ? `「${a.keyword}」` : ''}`,
    execute: (db, a) => linkListHandler(db, 1, 20, true, {
      keyword: a.keyword,
      categoryId: a.category_id,
      property: a.property,
    }),
  },
  {
    name: 'list_categories',
    description: '列出全部分类(含私密),含 id/名称/属性/描述/父子关系,可先调它拿 category_id。',
    parameters: { type: 'object', properties: {} },
    danger: 'read',
    summarize: (a, r) => `列出分类 ${(r as any)?.count ?? ''} 条`.trim(),
    execute: (db) => categoryListHandler(db, 1, 100, true),
  },
  {
    name: 'get_link',
    description: '按 id 获取单条链接完整详情。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
    danger: 'read',
    summarize: (a) => `查看链接 #${a.id}`,
    execute: (db, a) => getALinkHandler(db, a.id, true),
  },
  {
    name: 'get_click_stats',
    description: '查询最近 N 天链接点击量排行(on_clicks 聚合),用于"哪个链接最热门"类问题。',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', enum: [7, 30, 90], description: '统计窗口,默认 30' },
        limit: { type: 'number', description: '返回条数,默认 10' },
      },
    },
    danger: 'read',
    summarize: (a) => `最近 ${a.days ?? 30} 天点击排行`,
    execute: async (db, a) => {
      const days = a.days ?? 30;
      const limit = Math.min(50, Math.max(1, a.limit ?? 10));
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      const rows = await db.select({
        linkId: schema.clicks.linkId,
        title: schema.links.title,
        clicks: sql<number>`count(*)`,
      }).from(schema.clicks)
        .innerJoin(schema.links, eq(schema.clicks.linkId, schema.links.id))
        .where(gt(schema.clicks.ts, since))
        .groupBy(schema.clicks.linkId, schema.links.title)
        .orderBy(desc(sql`count(*)`))
        .limit(limit).all();
      return { code: 0, data: rows };
    },
  },
  {
    name: 'get_site_config',
    description: '读取站点设置(标题/副标题/隐私模式开关),不含任何密钥。',
    parameters: { type: 'object', properties: {} },
    danger: 'read',
    summarize: () => '读取站点设置',
    execute: async (db) => siteConfigData(await getSiteConfig(db)),
  },
  {
    name: 'fetch_url',
    description: '抓取任意网页/URL 并提取内容(标题、描述、正文文本、HTTP 状态码、重定向后最终地址)。适合"看看这个链接讲了什么"、检查链接是否可访问。不执行页面 JS:纯客户端渲染的 SPA 页面正文可能为空,此类页面改用 MCP 网页读取工具(如有)。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整 URL(含协议)' },
      },
      required: ['url'],
    },
    danger: 'read',
    summarize: (a, r) => {
      let host = String(a.url ?? '');
      try { host = new URL(host).host; } catch { /* 保留原样 */ }
      const title = r && typeof r === 'object' && (r as any).data?.title;
      return title ? `抓取 ${host}:${String(title).slice(0, 40)}` : `抓取 ${host}`;
    },
    execute: async (_db, a) => {
      try {
        return { code: 0, data: await fetchAndExtract(String(a.url ?? '')) };
      } catch (e) {
        return { code: -2000, msg: e instanceof Error ? e.message : '抓取失败' };
      }
    },
  },

  {
    name: 'memory_write',
    description: `整体替换长期记忆(跨会话持久,当前内容已在系统提示「长期记忆」段展示)。用于记住用户稳定偏好/重要事实,或清理合并过期内容。上限 ${MEMORY_MAX_CHARS} 字符,保持精简;空串=清空。`,
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '完整的新记忆内容(markdown 纯文本,整体替换)' },
      },
      required: ['content'],
    },
    danger: 'write',
    defaultPolicy: 'auto',   // 语义是写,但默认免确认("大模型自己更新");配置页可改回
    summarize: (a, r) => {
      const n = String(a.content ?? '').length;
      if (r && typeof r === 'object' && (r as any).code !== 0) return `更新长期记忆失败(${n} 字)`;
      return r == null ? `更新长期记忆(${n} 字)` : `已更新长期记忆(${(r as any).data?.length ?? n} 字)`;
    },
    execute: async (db, a) => {
      const content = String(a.content ?? '');
      if (content.length > MEMORY_MAX_CHARS) {
        return { code: -2000, msg: `记忆 ${content.length} 字符超过上限 ${MEMORY_MAX_CHARS},请压缩合并(剔除过期与冗余)后重写` };
      }
      await saveMemory(db, content);
      return { code: 0, data: { length: content.length } };
    },
  },

  // ---- 写操作(danger:'write'):执行由 agent 走人工确认流,execute 只在被确认后调用 ----
  {
    name: 'create_link',
    description: '新增书签链接。需要标题、URL、分类 id(可先用 list_categories 查)。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        url: { type: 'string' },
        category_id: { type: 'number' },
        description: { type: 'string', description: '备注,可选' },
        property: { type: 'number', enum: [0, 1], description: '0=公开(默认) 1=私密' },
      },
      required: ['title', 'url', 'category_id'],
    },
    danger: 'write',
    summarize: (a, r) => r && typeof r === 'object' && 'id' in r
      ? `已新增链接「${a.title}」(#${(r as any).id})`
      : `新增链接「${a.title}」→ ${a.url}${a.property === 1 ? '(私密)' : ''}`,
    execute: (db, a) => addLinkHandler(db, {
      fid: int(a.category_id, 1), title: String(a.title ?? ''), url: String(a.url ?? ''),
      description: String(a.description ?? ''), weight: 0, property: int(a.property),
      url_standby: '', font_icon: '',
    }),
  },
  {
    name: 'update_link',
    description: '修改链接。只传要改的字段,未传字段保持原值(id 必传)。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        title: { type: 'string' }, url: { type: 'string' },
        category_id: { type: 'number' }, description: { type: 'string' },
        property: { type: 'number', enum: [0, 1] },
      },
      required: ['id'],
    },
    danger: 'write',
    summarize: (a) => `修改链接 #${a.id}:${[a.title && '标题', a.url && 'URL', a.category_id && '分类', a.description && '描述', a.property !== undefined && '属性'].filter(Boolean).join('/') || '(无变更)'}`,
    execute: async (db, a) => {
      const cur: any = await getALinkHandler(db, int(a.id), true);
      if (cur.code !== 0 || !cur.data) return cur;
      const r = cur.data;
      return editLinkHandler(db, int(a.id), {
        fid: a.category_id !== undefined ? int(a.category_id) : r.fid,
        title: a.title !== undefined ? String(a.title) : r.title,
        url: a.url !== undefined ? String(a.url) : r.url,
        description: a.description !== undefined ? String(a.description) : (r.description ?? ''),
        weight: r.weight ?? 0,
        property: a.property !== undefined ? int(a.property) : r.property,
        url_standby: r.urlStandby ?? '', font_icon: r.fontIcon ?? '',
      });
    },
  },
  {
    name: 'delete_link',
    description: '删除链接(不可恢复,需用户确认)。',
    parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    danger: 'write',
    summarize: (a) => `删除链接 #${a.id}`,
    execute: (db, a) => delLinkHandler(db, int(a.id)),
  },
  {
    name: 'create_category',
    description: '新增分类。parent_id 为父分类 id(顶级省略或 0)。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        property: { type: 'number', enum: [0, 1] },
        parent_id: { type: 'number', description: '父分类 id,顶级省略' },
      },
      required: ['name'],
    },
    danger: 'write',
    summarize: (a) => `新增分类「${a.name}」${a.parent_id ? `(父分类 #${a.parent_id})` : ''}${a.property === 1 ? '(私密)' : ''}`,
    execute: (db, a) => addCategoryHandler(db, {
      name: String(a.name ?? ''), property: int(a.property), weight: 0,
      description: String(a.description ?? ''), font_icon: '', fid: a.parent_id !== undefined ? int(a.parent_id) : 0,
    }),
  },
  {
    name: 'update_category',
    description: '修改分类。只传要改的字段(id 必传)。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number' }, name: { type: 'string' },
        description: { type: 'string' }, property: { type: 'number', enum: [0, 1] },
      },
      required: ['id'],
    },
    danger: 'write',
    summarize: (a) => `修改分类 #${a.id}:${a.name ? `改名为「${a.name}」` : '更新字段'}`,
    execute: async (db, a) => {
      const cur: any = await getACategoryHandler(db, int(a.id), true);
      if (cur.code !== 0 || !cur.data) return cur;
      const r = cur.data;
      return editCategoryHandler(db, int(a.id), {
        name: a.name !== undefined ? String(a.name) : r.name,
        property: a.property !== undefined ? int(a.property) : r.property,
        weight: r.weight ?? 0,
        description: a.description !== undefined ? String(a.description) : (r.description ?? ''),
        font_icon: r.fontIcon ?? '', fid: r.fid ?? 0,
      });
    },
  },
  {
    name: 'delete_category',
    description: '删除分类。要求其下无子分类且无链接(否则会失败并告知原因)。',
    parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    danger: 'write',
    summarize: (a) => `删除分类 #${a.id}`,
    execute: (db, a) => delCategoryHandler(db, int(a.id)),
  },
];

export function findTool(name: string): AiTool | undefined {
  return AI_TOOLS.find(t => t.name === name);
}

/** OpenAI chat/completions 的 tools 参数 */
export function toolSpecs(): unknown[] {
  return AI_TOOLS.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
