import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { resetTables } from '../helpers';
import { addCategoryHandler } from '../../src/handlers/category';
import { addLinkHandler } from '../../src/handlers/link';
import { AI_TOOLS, findTool, toolSpecs, buildBatchTools, resolveExecPolicy } from '../../src/ai/tools';
import { saveAiConfig } from '../../src/ai/config';

beforeEach(async () => { await resetTables(); });
const db = () => getDb(env.DB);

async function seed() {
  const cat = await addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
  const link = await addLinkHandler(db(), { fid: cat.id, title: 'GitHub', url: 'https://github.com', description: '代码托管', weight: 0, property: 0, url_standby: '', font_icon: '' });
  return { cat, linkId: link.id };
}

describe('read tools', () => {
  it('search_links 命中标题关键词', async () => {
    await seed();
    const res: any = await findTool('search_links')!.execute(db(), { keyword: 'git' });
    expect(res.code).toBe(0);
    expect(res.count).toBe(1);
    expect(res.data[0].title).toBe('GitHub');
  });

  it('list_categories 返回全量(管理员视角,含私密)', async () => {
    await seed();
    await addCategoryHandler(db(), { name: '私密', property: 1, weight: 0, description: '', font_icon: '', fid: 0 });
    const res: any = await findTool('list_categories')!.execute(db(), {});
    expect(res.data).toHaveLength(2);
  });

  it('get_link 按 id 取详情,不存在时 code!=0(喂回模型自愈)', async () => {
    const { linkId } = await seed();
    const ok: any = await findTool('get_link')!.execute(db(), { id: linkId });
    expect(ok.code).toBe(0);
    const miss: any = await findTool('get_link')!.execute(db(), { id: 999 });
    expect(miss.code).not.toBe(0);
  });

  it('get_click_stats 聚合 on_clicks', async () => {
    const { linkId } = await seed();
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare('INSERT INTO on_clicks (link_id, ip, ua, referer, ts) VALUES (?,?,?,?,?)')
        .bind(linkId, '1.1.1.1', 'ua', '', now - i).run();
    }
    const res: any = await findTool('get_click_stats')!.execute(db(), { days: 30, limit: 10 });
    expect(res.data[0].linkId).toBe(linkId);
    expect(res.data[0].clicks).toBe(3);
    expect(res.data[0].title).toBe('GitHub');
  });

  it('get_site_config 返回站点设置', async () => {
    await saveAiConfig(db(), { providers: [], activeProviderId: null, systemPrompt: '', mcpServers: [] });
    const res: any = await findTool('get_site_config')!.execute(db(), {});
    expect(res.site_private).toBe(false);
    expect(res.site_title).toBe('NavBook');
  });

  it('注册表形态:danger 标注 + OpenAI tools 规格 + summarize 中文文案', () => {
    expect(AI_TOOLS.filter(t => t.danger === 'read')).toHaveLength(6);   // +fetch_url
    const spec = toolSpecs() as any[];
    expect(spec.every(s => s.type === 'function' && s.function.name && s.function.parameters)).toBe(true);
    expect(findTool('search_links')!.summarize({ keyword: 'git' }, null)).toContain('git');
    expect(findTool('nope')).toBeUndefined();
  });

  it('fetch_url:注册为 read 工具,summarize 提取 host 与标题', () => {
    const tool = findTool('fetch_url')!;
    expect(tool.danger).toBe('read');
    expect(tool.summarize({ url: 'https://example.com/a?x=1' }, null)).toBe('抓取 example.com');
    expect(tool.summarize({ url: 'https://example.com/a' }, { data: { title: '页面标题' } })).toContain('页面标题');
  });
});

describe('write tools', () => {
  it('六个单写工具全部注册且 danger=write(batch 工具由工厂动态生成,不在静态注册表)', () => {
    const writes = AI_TOOLS.filter(t => t.danger === 'write').map(t => t.name);
    expect(writes).toEqual([
      'create_link', 'update_link', 'delete_link',
      'create_category', 'update_category', 'delete_category',
    ]);
    expect(findTool('batch_write')).toBeUndefined();
    expect(findTool('batch_read')).toBeUndefined();
  });

  it('create_link 落库且 summarize 预执行文案含标题', async () => {
    const { cat } = await seed();
    const tool = findTool('create_link')!;
    expect(tool.summarize({ title: 'V2EX', url: 'https://v2ex.com', category_id: cat.id }, null))
      .toContain('V2EX');
    const res: any = await tool.execute(db(), { title: 'V2EX', url: 'https://v2ex.com', category_id: cat.id });
    expect(res.code).toBe(0);
  });

  it('update_link 部分字段:未提供的字段保持原值', async () => {
    const { cat, linkId } = await seed();
    const before: any = await findTool('get_link')!.execute(db(), { id: linkId });
    const res: any = await findTool('update_link')!.execute(db(), { id: linkId, description: '全球最大同性交友平台' });
    expect(res.code).toBe(0);
    const after: any = await findTool('get_link')!.execute(db(), { id: linkId });
    expect(after.data.description).toBe('全球最大同性交友平台');
    expect(after.data.title).toBe(before.data.title);   // 未传 title 不变
    void cat;
  });

  it('delete_link 删除后查无', async () => {
    const { linkId } = await seed();
    const res: any = await findTool('delete_link')!.execute(db(), { id: linkId });
    expect(res.code).toBe(0);
    const gone: any = await findTool('get_link')!.execute(db(), { id: linkId });
    expect(gone.code).not.toBe(0);
  });

  it('update_category 改名', async () => {
    const { cat } = await seed();
    const up: any = await findTool('update_category')!.execute(db(), { id: cat.id, name: '开发工具' });
    expect(up.code).toBe(0);
  });

  it('delete_category 有链接时 throw(经 agent 包装为错误 tool 结果)', async () => {
    const { catId } = await seed2();
    await expect(findTool('delete_category')!.execute(db(), { id: catId }))
      .rejects.toThrow('此分类下存在链接');
  });

  it('delete_category 空分类可删', async () => {
    const cat = await addCategoryHandler(db(), { name: '空', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    const res: any = await findTool('delete_category')!.execute(db(), { id: cat.id });
    expect(res.code).toBe(0);
  });
});

describe('batch_write', () => {
  it('多操作全部成功:逐项执行,code=0,ok_count=总数', async () => {
    const { cat } = await seed();
    const res: any = await batchWrite()!.execute(db(), { operations: [
      { action: 'create_category', args: { name: '新分类' } },
      { action: 'create_link', args: { title: 'V2EX', url: 'https://v2ex.com', category_id: cat.id } },
    ] });
    expect(res.code).toBe(0);
    expect(res.ok_count).toBe(2);
    expect(res.fail_count).toBe(0);
    expect(res.results[1].result.code).toBe(0);
    // D1 实证
    const cats: any = await findTool('list_categories')!.execute(db(), {});
    expect(cats.data).toHaveLength(2);
    const search: any = await findTool('search_links')!.execute(db(), { keyword: 'V2EX' });
    expect(search.count).toBe(1);
  });

  it('部分失败不中止:失败项记录错误,后续项继续', async () => {
    const { catId } = await seed2();
    const res: any = await batchWrite()!.execute(db(), { operations: [
      { action: 'delete_category', args: { id: catId } },   // 分类下有链接 → throw
      { action: 'create_category', args: { name: '兜底' } },
    ] });
    expect(res.code).toBe(-1);
    expect(res.fail_count).toBe(1);
    expect(res.results[0].ok).toBe(false);
    expect(res.results[0].error.msg).toContain('此分类下存在链接');
    expect(res.results[1].ok).toBe(true);
    const cats: any = await findTool('list_categories')!.execute(db(), {});
    expect(cats.data).toHaveLength(2);   // 原1 + 兜底1
  });

  it('非法 action(读工具/嵌套/未知)按单项失败,其余照常', async () => {
    const res: any = await batchWrite()!.execute(db(), { operations: [
      { action: 'search_links', args: {} },
      { action: 'batch_write', args: { operations: [] } },
      { action: 'nope_tool', args: {} },
      { action: 'create_category', args: { name: 'X' } },
    ] });
    expect(res.results[0].ok).toBe(false);
    expect(res.results[0].error.msg).toContain('不允许的操作');
    expect(res.results[1].ok).toBe(false);
    expect(res.results[2].ok).toBe(false);
    expect(res.results[3].ok).toBe(true);
  });

  it('空列表/超 20 项 throw(经 agent 包装为错误 tool 结果)', async () => {
    const tool = batchWrite()!;
    await expect(tool.execute(db(), { operations: [] })).rejects.toThrow('不能为空');
    const ops21 = Array.from({ length: 21 }, () => ({ action: 'create_category', args: { name: 'x' } }));
    await expect(tool.execute(db(), { operations: ops21 })).rejects.toThrow('最多');
  });

  it('summarize 预执行:多行编号,复用子工具文案', () => {
    const s = batchWrite()!.summarize({ operations: [
      { action: 'create_link', args: { title: 'V2EX', url: 'https://v2ex.com', category_id: 1 } },
      { action: 'delete_link', args: { id: 2 } },
      { action: 'search_links', args: {} },
    ] }, null);
    expect(s).toContain('\n');
    expect(s).toContain('1. 新增链接「V2EX」');
    expect(s).toContain('2. 删除链接 #2');
    expect(s).toContain('不可批次执行');
  });

  it('summarize 执行后:计数 + 失败明细,且不含「取消」(rejected 误判防护)', async () => {
    const { catId } = await seed2();
    const res: any = await batchWrite()!.execute(db(), { operations: [
      { action: 'delete_category', args: { id: catId } },
      { action: 'create_category', args: { name: '兜底' } },
    ] });
    const s = batchWrite()!.summarize({ operations: [] }, res);
    expect(s).toContain('1 成功,1 失败');
    expect(s).toContain('此分类下存在链接');
    expect(s).not.toContain('取消');
  });
});

// 独立建第二个分类+链接(delete_category throw 用例需要拿真实 id)
async function seed2() {
  const cat = await addCategoryHandler(db(), { name: '工具2', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
  const link = await addLinkHandler(db(), { fid: cat.id, title: 'X', url: 'https://x.example.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
  return { catId: cat.id, linkId: link.id };
}

// ---- 统一批量协议与执行策略(工厂) ----

/** 默认策略下的 batch_write 实例 */
function batchWrite() {
  return buildBatchTools(AI_TOOLS, {}).find(t => t.name === 'batch_write');
}
function batchRead() {
  return buildBatchTools(AI_TOOLS, {}).find(t => t.name === 'batch_read');
}

describe('buildBatchTools 动态枚举与策略', () => {
  it('默认策略:batch_read 枚举=全部读工具,batch_write 枚举=全部写工具(防漂移)', () => {
    const reads = AI_TOOLS.filter(t => t.danger === 'read').map(t => t.name);
    const writes = AI_TOOLS.filter(t => t.danger === 'write').map(t => t.name);
    const br: any = batchRead()!.parameters;
    const bw: any = batchWrite()!.parameters;
    expect(br.properties.operations.items.properties.action.enum).toEqual(reads);
    expect(bw.properties.operations.items.properties.action.enum).toEqual(writes);
  });

  it('toolPolicy 覆盖:fetch_url 设 confirm → 移入 batch_write 枚举、移出 batch_read', () => {
    const tools = buildBatchTools(AI_TOOLS, { fetch_url: 'confirm' });
    const br: any = tools.find(t => t.name === 'batch_read')!.parameters;
    const bw: any = tools.find(t => t.name === 'batch_write')!.parameters;
    expect(br.properties.operations.items.properties.action.enum).not.toContain('fetch_url');
    expect(bw.properties.operations.items.properties.action.enum).toContain('fetch_url');
  });

  it('resolveExecPolicy:配置覆盖 > danger 默认', () => {
    const fetchTool = findTool('fetch_url')!;
    expect(resolveExecPolicy(fetchTool, {})).toBe('auto');
    expect(resolveExecPolicy(fetchTool, { fetch_url: 'confirm' })).toBe('confirm');
    expect(resolveExecPolicy(findTool('delete_link')!, {})).toBe('confirm');
    expect(resolveExecPolicy(findTool('delete_link')!, { delete_link: 'auto' })).toBe('auto');
  });
});

describe('batch_read', () => {
  it('多项读操作:全部成功,结果按提交顺序逐项返回', async () => {
    await seed();
    const res: any = await batchRead()!.execute(db(), { operations: [
      { action: 'search_links', args: { keyword: 'git' } },
      { action: 'list_categories', args: {} },
      { action: 'get_site_config', args: {} },
    ] });
    expect(res.code).toBe(0);
    expect(res.ok_count).toBe(3);
    expect(res.results[0].result.count).toBe(1);        // search_links
    expect(res.results[1].result.data.length).toBe(1);  // list_categories
    expect(res.results[2].result.site_title).toBe('NavBook');
  });

  it('策略不符(写工具/嵌套)按单项失败,其余照常', async () => {
    await seed();
    const res: any = await batchRead()!.execute(db(), { operations: [
      { action: 'delete_link', args: { id: 1 } },
      { action: 'batch_read', args: { operations: [] } },
      { action: 'list_categories', args: {} },
    ] });
    expect(res.results[0].ok).toBe(false);
    expect(res.results[0].error.msg).toContain('不允许的操作');
    expect(res.results[1].ok).toBe(false);
    expect(res.results[2].ok).toBe(true);
    expect(res.ok_count).toBe(1);
  });

  it('超过 10 项拒绝', async () => {
    const ops = Array.from({ length: 11 }, () => ({ action: 'list_categories', args: {} }));
    await expect(batchRead()!.execute(db(), { operations: ops })).rejects.toThrow('最多');
  });

  it('并发池顺序保持:结果 index 与提交顺序一致(乱序完成不乱序返回)', async () => {
    await seed();
    const ops = Array.from({ length: 6 }, (_, i) => ({ action: 'search_links', args: { keyword: i === 2 ? 'git' : '不存在的词xyz' } }));
    const res: any = await batchRead()!.execute(db(), { operations: ops });
    expect(res.results.map((r: any) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(res.results[2].result.count).toBe(1);   // git 命中
    expect(res.results[0].result.count).toBe(0);   // 其余 0 命中(code 0,count 0)
  });
});
