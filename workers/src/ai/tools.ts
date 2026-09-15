// 工具注册表:execute 直调 handlers/* 纯函数(权限天然=管理员,业务校验/转义全复用)。
// 不知道 provider/agent 的存在;新增工具=加一个条目。
import { eq, gt, desc, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { WorkerDB } from './types';
import { linkListHandler, getALinkHandler } from '../handlers/link';
import { categoryListHandler, getACategoryHandler } from '../handlers/category';
import { getSiteConfig, siteConfigData } from '../handlers/site';

export interface AiTool {
  name: string;
  description: string;                 // 给模型看的中文说明
  parameters: Record<string, unknown>; // JSON Schema(OpenAI function calling)
  danger: 'read' | 'write';
  /** 确认卡(执行前 result=null)与结果卡(执行后)的中文文案,后端生成前端照渲染 */
  summarize(args: Record<string, any>, result: unknown): string;
  execute(db: WorkerDB, args: Record<string, any>): Promise<unknown>;
}

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

// Task 12(写工具)将向 AI_TOOLS 追加 6 个写工具;此处 re-export 为其过渡。
export { getACategoryHandler };
