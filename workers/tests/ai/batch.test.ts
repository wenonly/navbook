// 批量工具工厂与执行策略测试(自 tools.test 迁入,聚焦 batch.ts)。
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { resetTables } from '../helpers';
import { addCategoryHandler } from '../../src/handlers/category';
import { addLinkHandler } from '../../src/handlers/link';
import { AI_TOOLS, findTool } from '../../src/ai/tools';
import { buildBatchTools, resolveExecPolicy } from '../../src/ai/batch';

beforeEach(async () => { await resetTables(); });
const db = () => getDb(env.DB);

async function seed() {
  const cat = await addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
  const link = await addLinkHandler(db(), { fid: cat.id, title: 'GitHub', url: 'https://github.com', description: '代码托管', weight: 0, property: 0, url_standby: '', font_icon: '' });
  return { cat, linkId: link.id };
}
async function seed2() {
  const cat = await addCategoryHandler(db(), { name: '工具2', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
  const link = await addLinkHandler(db(), { fid: cat.id, title: 'X', url: 'https://x.example.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
  return { catId: cat.id, linkId: link.id };
}
function batchWrite() { return buildBatchTools(AI_TOOLS, {}).find(t => t.name === 'batch_write'); }
function batchRead() { return buildBatchTools(AI_TOOLS, {}).find(t => t.name === 'batch_read'); }

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

// ---- 统一批量协议与执行策略(工厂) ----

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
