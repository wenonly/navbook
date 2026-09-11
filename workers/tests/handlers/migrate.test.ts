import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { exportJsonHandler, importJsonHandler } from '../../src/handlers/migrate';
import { addCategoryHandler } from '../../src/handlers/category';
import { addLinkHandler } from '../../src/handlers/link';
import { resetTables } from '../helpers';

beforeEach(async () => {
  await resetTables();
});

const db = () => getDb(env.DB);

const catInput = (name: string, fid = 0, property = 0) =>
  ({ name, property, weight: 0, description: '', font_icon: '', fid });
const linkInput = (fid: number, title: string, url: string) =>
  ({ fid, title, url, description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });

describe('export_json', () => {
  it('空库返回空 categories + 固定 type/version', async () => {
    const res = await exportJsonHandler(db());
    expect(res.code).toBe(0);
    expect(res.data.type).toBe('onenav.bookmarks');
    expect(res.data.version).toBe(1);
    expect(res.data.categories).toEqual([]);
  });

  it('两级树结构 + 字段映射（backup_url/sort_order）+ 实体解码', async () => {
    const top = await addCategoryHandler(db(), catInput('一级'));
    const sub = await addCategoryHandler(db(), catInput('二级', top.id));
    await addLinkHandler(db(), { ...linkInput(top.id, 'A&B <tag>', 'https://a.com'), url_standby: 'https://bak.com', weight: 3 });
    await addLinkHandler(db(), linkInput(sub.id, 'Sub', 'https://s.com'));

    const res = await exportJsonHandler(db());
    const cats = res.data.categories;
    expect(cats.length).toBe(1);
    expect(cats[0].name).toBe('一级');
    expect(cats[0].links.length).toBe(1);
    expect(cats[0].links[0].title).toBe('A&B <tag>');
    expect(cats[0].links[0].backup_url).toBe('https://bak.com');
    expect(cats[0].links[0].sort_order).toBe(3);
    expect(cats[0].children.length).toBe(1);
    expect(cats[0].children[0].links[0].url).toBe('https://s.com');
  });

  it('私有分类不出现在导出', async () => {
    await addCategoryHandler(db(), catInput('公开'));
    await addCategoryHandler(db(), catInput('私有', 0, 1));
    const res = await exportJsonHandler(db());
    expect(res.data.categories.map(c => c.name)).toEqual(['公开']);
  });
});

describe('import_json', () => {
  const payload = (categories: unknown[]) => ({ type: 'onenav.bookmarks', version: 1, categories });

  it('空库导入：建分类（两级）+ 插链接 + 统计', async () => {
    const res = await importJsonHandler(db(), payload([
      {
        name: '一级', description: 'd1',
        links: [{ title: 'A', url: 'https://a.com', description: 'x', backup_url: '', sort_order: 5 }],
        children: [{ name: '二级', description: '', links: [{ title: 'B', url: 'https://b.com' }] }],
      },
    ]));
    expect(res.code).toBe(0);
    expect(res.data.categories_created).toBe(2);
    expect(res.data.categories_reused).toBe(0);
    expect(res.data.links_imported).toBe(2);
    expect(res.data.links_skipped).toBe(0);

    const { publicNavHandler } = await import('../../src/handlers/public');
    const nav = await publicNavHandler(db());
    expect(nav.data.categories[0].name).toBe('一级');
    expect(nav.data.categories[0].children[0].name).toBe('二级');
    expect(nav.data.categories[0].links[0].title).toBe('A');
  });

  it('重复导入幂等：分类复用 + URL 去重跳过', async () => {
    const p = payload([{ name: '一级', links: [{ title: 'A', url: 'https://a.com' }], children: [] }]);
    await importJsonHandler(db(), p);
    const again = await importJsonHandler(db(), p);
    expect(again.data.categories_created).toBe(0);
    expect(again.data.categories_reused).toBe(1);
    expect(again.data.links_imported).toBe(0);
    expect(again.data.links_skipped).toBe(1);
  });

  it('合并到已有数据：同名分类复用，新链接插入', async () => {
    const top = await addCategoryHandler(db(), catInput('一级'));
    await addLinkHandler(db(), linkInput(top.id, 'Old', 'https://old.com'));
    const res = await importJsonHandler(db(), payload([
      {
        name: '一级', links: [{ title: 'New', url: 'https://new.com' }],
        children: [{ name: '新二级', links: [] }],
      },
    ]));
    expect(res.data.categories_created).toBe(1);
    expect(res.data.categories_reused).toBe(1);
    expect(res.data.links_imported).toBe(1);
    expect(res.data.links_skipped).toBe(0);
    const { linkListHandler } = await import('../../src/handlers/link');
    const list = await linkListHandler(db(), 1, 100, true);
    expect(list.data.some((l: any) => l.title === 'New')).toBe(true);
  });

  it('文件内重复 URL 只导入一次', async () => {
    const res = await importJsonHandler(db(), payload([
      { name: 'x', links: [
        { title: 'A', url: 'https://dup.com' },
        { title: 'B', url: 'https://dup.com' },
      ], children: [] },
    ]));
    expect(res.data.links_imported).toBe(1);
    expect(res.data.links_skipped).toBe(1);
  });

  it('入库前 HTML 转义（与手建路径一致）', async () => {
    await importJsonHandler(db(), payload([
      { name: '<i>名</i>', links: [{ title: '<b>T</b>', url: 'https://a.com' }], children: [] },
    ]));
    const row = await env.DB.prepare(
      "SELECT name FROM on_categorys WHERE id = (SELECT MIN(id) FROM on_categorys)"
    ).first<{ name: string }>();
    expect(row!.name).toBe('&lt;i&gt;名&lt;/i&gt;');
  });

  it('非法 type 拒绝', async () => {
    await expect(importJsonHandler(db(), { type: 'wrong', categories: [] })).rejects.toThrow();
  });

  it('空 title 链接被 schema 拒绝', async () => {
    await expect(importJsonHandler(db(), payload([
      { name: 'x', links: [{ title: '', url: 'https://a.com' }], children: [] },
    ]))).rejects.toThrow();
  });
});
