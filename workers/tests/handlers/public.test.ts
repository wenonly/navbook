import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { addCategoryHandler } from '../../src/handlers/category';
import { addLinkHandler } from '../../src/handlers/link';
import { publicNavHandler } from '../../src/handlers/public';
import { resetTables } from '../helpers';

beforeEach(async () => {
  await resetTables();
});

const db = () => getDb(env.DB);

describe('public_nav', () => {
  it('返回两级分类 + 公开链接，私有数据被过滤', async () => {
    const top = await addCategoryHandler(db(), { name: '一级', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    const sub = await addCategoryHandler(db(), { name: '二级', property: 0, weight: 0, description: '', font_icon: '', fid: top.id });
    const priv = await addCategoryHandler(db(), { name: '私有', property: 1, weight: 0, description: '', font_icon: '', fid: 0 });

    await addLinkHandler(db(), { fid: sub.id, title: 'SubLink', url: 'https://sub.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
    await addLinkHandler(db(), { fid: top.id, title: 'TopLink', url: 'https://top.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
    await addLinkHandler(db(), { fid: priv.id, title: 'PrivLink', url: 'https://priv.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });

    const res = await publicNavHandler(db(), false);
    expect(res.code).toBe(0);
    expect(res.data.site_title).toBe('OneNav');
    expect(res.data.categories.length).toBe(1);
    const topCat = res.data.categories[0];
    expect(topCat.name).toBe('一级');
    expect(topCat.links.map((l) => l.title)).toContain('TopLink');
    expect(topCat.children.length).toBe(1);
    expect(topCat.children[0].links[0].title).toBe('SubLink');
  });

  it('私有链接不出现在公开分类下', async () => {
    const cat = await addCategoryHandler(db(), { name: '公开', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    await addLinkHandler(db(), { fid: cat.id, title: 'Pub', url: 'https://a.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
    await addLinkHandler(db(), { fid: cat.id, title: 'Priv', url: 'https://b.com', description: '', weight: 0, property: 1, url_standby: '', font_icon: '' });

    const res = await publicNavHandler(db(), false);
    expect(res.data.categories[0].links.length).toBe(1);
    expect(res.data.categories[0].links[0].title).toBe('Pub');
  });

  it('site_title 从 on_options 读取', async () => {
    await env.DB.prepare('INSERT INTO on_options (key, value) VALUES (?, ?)').bind('site_title', '我的导航').run();
    const res = await publicNavHandler(db(), false);
    expect(res.data.site_title).toBe('我的导航');
  });

  it('空库返回空数组', async () => {
    const res = await publicNavHandler(db(), false);
    expect(res.code).toBe(0);
    expect(res.data.categories).toEqual([]);
  });

  it('名字含特殊字符时 API 输出明文（读路径解码）', async () => {
    const top = await addCategoryHandler(db(), { name: '影视&动漫', property: 0, weight: 0, description: 'A&B', font_icon: '', fid: 0 });
    await addLinkHandler(db(), { fid: top.id, title: 'X<Y>', url: 'https://xy.com', description: 'd&e', weight: 0, property: 0, url_standby: '', font_icon: '' });

    const res = await publicNavHandler(db(), false);
    const cat = res.data.categories[0];
    expect(cat.name).toBe('影视&动漫');
    expect(cat.description).toBe('A&B');
    expect(cat.links[0].title).toBe('X<Y>');
    expect(cat.links[0].description).toBe('d&e');
  });

  it('管理员（isAuthed）返回全量含 private 标记', async () => {
    const pubCat = await addCategoryHandler(db(), { name: '公开', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
    const privCat = await addCategoryHandler(db(), { name: '私密分类', property: 1, weight: 0, description: '', font_icon: '', fid: 0 });
    const { addLinkHandler } = await import('../../src/handlers/link');
    await addLinkHandler(db(), { fid: pubCat.id, title: 'Pub', url: 'https://p.com', description: '', weight: 0, property: 0, url_standby: '', font_icon: '' });
    await addLinkHandler(db(), { fid: privCat.id, title: 'Priv', url: 'https://v.com', description: '', weight: 0, property: 1, url_standby: '', font_icon: '' });

    const guest = await publicNavHandler(db(), false);
    expect(guest.data.categories.map(c => c.name)).toEqual(['公开']);

    const admin = await publicNavHandler(db(), true);
    const names = admin.data.categories.map(c => c.name);
    expect(names).toContain('公开');
    expect(names).toContain('私密分类');
    const priv = admin.data.categories.find(c => c.name === '私密分类')!;
    expect(priv.private).toBe(true);
    expect(priv.links[0].private).toBe(true);
    const pub = admin.data.categories.find(c => c.name === '公开')!;
    expect(pub.private).toBe(false);
    expect(pub.links[0].private).toBe(false);
  });
});
