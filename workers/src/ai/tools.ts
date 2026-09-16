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

export interface AiTool {
  name: string;
  description: string;                 // 给模型看的中文说明
  parameters: Record<string, unknown>; // JSON Schema(OpenAI function calling)
  danger: 'read' | 'write';
  /** 确认卡(执行前 result=null)与结果卡(执行后)的中文文案,后端生成前端照渲染 */
  summarize(args: Record<string, any>, result: unknown): string;
  execute(db: WorkerDB, args: Record<string, any>): Promise<unknown>;
}

const int = (v: unknown, dflt = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

const BATCH_WRITE_MAX = 20;
const BATCH_READ_MAX = 10;
const BATCH_READ_CONCURRENCY = 4;

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


// ---- 执行策略与批量工具工厂 ----

/** 唯一决策点:所有确认行为收口到这一个纯函数(配置覆盖 > 工具默认;MCP trust 已映射进 danger) */
export function resolveExecPolicy(tool: Pick<AiTool, 'name' | 'danger'>, policy: ToolPolicy): 'auto' | 'confirm' {
  return policy[tool.name] ?? (tool.danger === 'write' ? 'confirm' : 'auto');
}

/** 简单并发池:最多 limit 个 in-flight,结果保持提交顺序 */
async function runPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 批量工具工厂:action 枚举按「当前可用工具集 + 最终策略」动态生成——
 * 内置与 MCP 通吃,未来任何新工具零代码自动可嵌。读批并发、写批顺序(确认卡清单编号确定)。
 */
export function buildBatchTools(available: AiTool[], policy: ToolPolicy): AiTool[] {
  const isBatch = (t: AiTool) => t.name === 'batch_read' || t.name === 'batch_write';
  const autoActions = available.filter(t => !isBatch(t) && resolveExecPolicy(t, policy) === 'auto').map(t => t.name);
  const confirmActions = available.filter(t => !isBatch(t) && resolveExecPolicy(t, policy) === 'confirm').map(t => t.name);
  const byName = new Map(available.map(t => [t.name, t]));

  const opSchema = (enumNames: string[], max: number) => ({
    type: 'array', minItems: 1, maxItems: max,
    description: '操作列表(按提交顺序)',
    items: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: enumNames },
        args: { type: 'object', description: '该工具的参数对象' },
      },
      required: ['action', 'args'],
    },
  });

  async function runOps(db: WorkerDB, ops: any[], want: 'auto' | 'confirm', concurrent: boolean) {
    const results: any[] = [];
    let okCount = 0;
    const execOne = async (op: any, i: number) => {
      const tool = byName.get(String(op?.action));
      if (!tool || isBatch(tool) || resolveExecPolicy(tool, policy) !== want) {
        results[i] = { index: i, action: op?.action, ok: false,
          error: { code: -2000, msg: `不允许的操作:${String(op?.action)}(本批仅接受${want === 'auto' ? '直接执行' : '需确认'}类工具,且不能嵌套 batch)` } };
        return;
      }
      try {
        const res = await tool.execute(db, (op.args ?? {}) as Record<string, any>);
        const ok = !(res && typeof res === 'object' && 'code' in res && (res as any).code !== 0);
        if (ok) okCount++;
        results[i] = { index: i, action: op.action, ok, result: res };
      } catch (e) {
        results[i] = { index: i, action: op.action, ok: false,
          error: { code: -2000, msg: e instanceof Error ? e.message : '执行异常' } };
      }
    };
    if (concurrent) await runPool(ops, BATCH_READ_CONCURRENCY, execOne);
    else for (let i = 0; i < ops.length; i++) await execOne(ops[i], i);   // 写有序、清单编号确定
    return { code: okCount === ops.length ? 0 : -1,   // 部分失败 → 顶层 code=-1,卡片显红"失败"
      total: ops.length, ok_count: okCount, fail_count: ops.length - okCount, results };
  }

  const summarizeBatch = (label: string, a: Record<string, any>, r: unknown, allowed: string[]) => {
    const ops: any[] = Array.isArray(a.operations) ? a.operations : [];
    if (r == null) {   // 确认卡/预执行:编号多行清单,复用子工具 summarize(args, null)
      const lines = ops.map((op, i) => {
        const t = byName.get(String(op?.action));
        return `${i + 1}. ${t && allowed.includes(t.name) ? t.summarize(op.args ?? {}, null) : `(${String(op?.action)} 不可批次执行)`}`;
      });
      return `批量 ${ops.length} 项${label}:\n${lines.join('\n')}`;
    }
    const b = r as any;   // 结果卡:计数 + 失败明细
    const head = `批量 ${b.total ?? ops.length} 项:${b.ok_count ?? 0} 成功,${b.fail_count ?? 0} 失败`;
    const fails = (b.results ?? []).filter((x: any) => !x.ok)
      .map((x: any) => `#${x.index + 1} ${x.action} 失败:${x.error?.msg ?? x.result?.msg ?? '未知错误'}`);
    return [head, ...fails].join('\n');
  };

  return [
    {
      name: 'batch_read',
      description: `批量执行多个查询/读取类工具,并发运行(抓取多个链接、多处搜索等场景优先用本工具一次提交;最多 ${BATCH_READ_MAX} 项,并发 ${BATCH_READ_CONCURRENCY})。单项失败不影响其余,结果按提交顺序逐项返回。`,
      parameters: { type: 'object', properties: { operations: opSchema(autoActions, BATCH_READ_MAX) }, required: ['operations'] },
      danger: 'read',
      summarize: (a, r) => summarizeBatch('读操作', a, r, autoActions),
      execute: async (db, a) => {
        const ops = a.operations;
        if (!Array.isArray(ops) || ops.length === 0) throw new Error('operations 不能为空');
        if (ops.length > BATCH_READ_MAX) throw new Error(`单次最多 ${BATCH_READ_MAX} 个操作,请拆分提交`);
        return runOps(db, ops, 'auto', true);
      },
    },
    {
      name: 'batch_write',
      description: `批量提交多个写/需确认操作,一张确认卡整批执行(≥2 项此类操作时优先用本工具,单项仍用对应单工具;最多 ${BATCH_WRITE_MAX} 项)。operations 按顺序执行,单项失败不影响其余,结果逐项返回。`,
      parameters: { type: 'object', properties: { operations: opSchema(confirmActions, BATCH_WRITE_MAX) }, required: ['operations'] },
      danger: 'write',
      summarize: (a, r) => summarizeBatch('写操作', a, r, confirmActions),
      execute: async (db, a) => {
        const ops = a.operations;
        if (!Array.isArray(ops) || ops.length === 0) throw new Error('operations 不能为空');
        if (ops.length > BATCH_WRITE_MAX) throw new Error(`单次最多 ${BATCH_WRITE_MAX} 个操作,请拆分提交`);
        return runOps(db, ops, 'confirm', false);
      },
    },
  ];
}
