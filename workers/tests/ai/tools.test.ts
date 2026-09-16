import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { resetTables } from '../helpers';
import { addCategoryHandler } from '../../src/handlers/category';
import { addLinkHandler } from '../../src/handlers/link';
import { AI_TOOLS, findTool, toolSpecs } from '../../src/ai/tools';
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
  it('写工具注册:6 个数据写 + memory_write(默认 auto,见 batch.test);batch 由工厂生成', () => {
    const writes = AI_TOOLS.filter(t => t.danger === 'write').map(t => t.name);
    expect(writes).toEqual([
      'memory_write',
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

// 独立建第二个分类+链接(delete_category throw 用例需要拿真实 id)
async function seed2() {
  const cat = await addCategoryHandler(db(), { name: '工具2', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
  const link = await addLinkHandler(db(), { fid: cat.id, title: 'X', url: 'https://x.example.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
  return { catId: cat.id, linkId: link.id };
}
