import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { exportJsonHandler } from '../../src/handlers/migrate';
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
