// 操作日志:handler 层留痕正确性(快照/source/batch 逐条/AI 工具读取)。
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { resetTables } from '../helpers';
import { addCategoryHandler, editCategoryHandler, delCategoryHandler } from '../../src/handlers/category';
import { addLinkHandler, editLinkHandler, delLinkHandler } from '../../src/handlers/link';
import { setSiteConfig } from '../../src/handlers/site';
import { saveMemory } from '../../src/ai/memory';
import { listOpLogs } from '../../src/handlers/oplog';
import { findTool, AI_TOOLS } from '../../src/ai/tools';
import { buildBatchTools } from '../../src/ai/batch';

beforeEach(async () => { await resetTables(); });
const db = () => getDb(env.DB);
const AI = { source: 'ai' as const, conversationId: 42 };

async function seedCat() {
  return addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
}
const linkInput = (fid: number, url = 'https://github.com') => ({
  fid, title: 'GitHub', url, description: '', weight: 0, property: 0, url_standby: '', font_icon: '',
});

describe('操作日志留痕', () => {
  it('link 增删改:action/快照方向正确(create 仅 after,update 双份,delete 仅 before)', async () => {
    const cat = await seedCat();
    await addLinkHandler(db(), linkInput(cat.id), AI);
    const added = await addLinkHandler(db(), linkInput(cat.id, 'https://v2ex.com'), AI);

    await editLinkHandler(db(), added.id, { ...linkInput(cat.id, 'https://v2ex.com'), title: 'V2EX 改名' }, AI);
    await delLinkHandler(db(), added.id, AI);

    const logs = (await listOpLogs(db(), 10)).filter(l => l.action.startsWith('link.'));
    expect(logs.map(l => l.action)).toEqual(['link.delete', 'link.update', 'link.create', 'link.create']);
    const del = logs[0], upd = logs[1], cre = logs[3];   // 倒序:第 3 条才是首次 create(github)
    expect(cre.after).toMatchObject({ title: 'GitHub', url: 'https://github.com' });
    expect(cre.before).toBeNull();
    expect(upd.before).toMatchObject({ title: 'GitHub' });
    expect(upd.after).toMatchObject({ title: 'V2EX 改名' });
    expect(del.before).toMatchObject({ url: 'https://v2ex.com' });
    expect(del.after).toBeNull();
    // AI 来源与来源会话
    for (const l of logs) { expect(l.source).toBe('ai'); expect(l.conversationId).toBe(42); }
    // 摘要可读
    expect(del.summary).toContain('V2EX');
  });

  it('手动操作 source=manual(缺省 meta)', async () => {
    const cat = await seedCat();
    await addLinkHandler(db(), linkInput(cat.id));   // 不传 meta
    const [log] = await listOpLogs(db(), 1);
    expect(log.source).toBe('manual');
    expect(log.conversationId).toBeNull();
  });

  it('category 增改删全留痕;site/memory 亦然', async () => {
    const cat = await seedCat();
    await editCategoryHandler(db(), cat.id, { name: '开发', property: 0, weight: 0, description: '', font_icon: '', fid: 0 }, AI);
    await delCategoryHandler(db(), cat.id, AI);
    await setSiteConfig(db(), { siteTitle: '新标题' }, AI);
    await saveMemory(db(), '记住:偏好简洁', AI);

    const logs = (await listOpLogs(db(), 10)).filter(l => !l.action.startsWith('link.'));
    expect(logs.map(l => l.action)).toEqual(
      ['memory.update', 'site.update', 'category.delete', 'category.update', 'category.create']);
    expect(logs[1].after).toMatchObject({ siteTitle: '新标题' });
    expect(logs[0].before).toEqual({ content: '' });
    expect(logs[0].after).toEqual({ content: '记住:偏好简洁' });
  });

  it('batch_write 逐条入账(分解到单 handler 自动继承)', async () => {
    const batch = buildBatchTools(AI_TOOLS, {});
    const bw = batch.find(t => t.name === 'batch_write')!;
    await bw.execute(db(), { operations: [
      { action: 'create_category', args: { name: '批量分类' } },
    ] }, AI);
    const [log] = await listOpLogs(db(), 1);
    expect(log.action).toBe('category.create');
    expect(log.source).toBe('ai');
    expect(log.conversationId).toBe(42);
  });

  it('op_log_list 工具:read 注册,返回最近 N 条含快照', async () => {
    const tool = findTool('op_log_list')!;
    expect(tool.danger).toBe('read');
    const cat = await seedCat();
    await addLinkHandler(db(), linkInput(cat.id), AI);
    const res: any = await tool.execute(db(), { limit: 5 });
    expect(res.code).toBe(0);
    expect(res.data.length).toBeGreaterThanOrEqual(2);
    expect(res.data[0].summary).toBeTruthy();
    // 上限 20
    const capped: any = await tool.execute(db(), { limit: 999 });
    expect(capped.data.length).toBeLessThanOrEqual(20);
  });
});

describe('GET /api/op_logs 端点', () => {
  it('未登录 401;登录返回分页列表(倒序含快照)', async () => {
    const { createApp } = await import('../../src/router');
    const { resetTables, seedUser, validCookie } = await import('../helpers');
    await resetTables(); await seedUser();
    const cat = await addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    await addLinkHandler(db(), linkInput(cat.id), AI);

    const UA = 'oplog-agent';
    const noauth = await createApp().request(new Request('http://x/api/op_logs'), undefined, env as any);
    expect(noauth.status).toBe(401);

    const authed = (p: string) => createApp().request(new Request(`http://x${p}`, {
      headers: { cookie: `key=${validCookie(UA)}`, 'user-agent': UA },
    }), undefined, env as any);
    const res = await authed('/api/op_logs?page=1&limit=10');
    const json: any = await res.json();
    expect(json.code).toBe(0);
    expect(json.count).toBe(2);                       // category.create + link.create
    expect(json.data[0].action).toBe('link.create');  // 倒序(最新在前)
    expect(json.data[0].after).toMatchObject({ title: 'GitHub' });
    expect(json.data[0].source).toBe('ai');
    expect(json.data[0].conversationId).toBe(42);
  });
});
