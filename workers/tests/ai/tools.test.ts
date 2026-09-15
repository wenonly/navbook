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
    await saveAiConfig(db(), { providers: [], activeProviderId: null, systemPrompt: '' });
    const res: any = await findTool('get_site_config')!.execute(db(), {});
    expect(res.site_private).toBe(false);
    expect(res.site_title).toBe('NavBook');
  });

  it('注册表形态:danger 标注 + OpenAI tools 规格 + summarize 中文文案', () => {
    expect(AI_TOOLS.filter(t => t.danger === 'read')).toHaveLength(5);
    const spec = toolSpecs() as any[];
    expect(spec.every(s => s.type === 'function' && s.function.name && s.function.parameters)).toBe(true);
    expect(findTool('search_links')!.summarize({ keyword: 'git' }, null)).toContain('git');
    expect(findTool('nope')).toBeUndefined();
  });
});
