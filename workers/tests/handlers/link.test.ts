import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { addCategoryHandler } from '../../src/handlers/category';
import {
  addLinkHandler, editLinkHandler, delLinkHandler,
  linkListHandler, qCategoryLinkHandler, getALinkHandler,
} from '../../src/handlers/link';
import { resetTables } from '../helpers';

beforeEach(async () => {
  await resetTables();
});

const db = () => getDb(env.DB);

async function seedCat() {
  return addCategoryHandler(db(), { name: '工具', property: 0, weight: 0, description: '', font_icon: '', fid: 0 });
}

const linkInput = (fid: number, url = 'https://github.com') => ({
  fid, title: 'GitHub', url, description: '', weight: 0, property: 0, url_standby: '', font_icon: '',
});

describe('add_link', () => {
  it('新增成功返回 id', async () => {
    const cat = await seedCat();
    const res = await addLinkHandler(db(), linkInput(cat.id));
    expect(res.code).toBe(0);
    expect(res.id).toBeGreaterThan(0);
  });

  it('fid 不存在时报错', async () => {
    await expect(addLinkHandler(db(), linkInput(999))).rejects.toThrow('分类ID不存在');
  });

  it('URL 重复抛 The URL already exists!', async () => {
    const cat = await seedCat();
    await addLinkHandler(db(), linkInput(cat.id));
    await expect(addLinkHandler(db(), linkInput(cat.id))).rejects.toThrow('The URL already exists!');
  });

  it('HTML 注入被转义', async () => {
    const cat = await seedCat();
    await addLinkHandler(db(), { ...linkInput(cat.id), title: '<b>x</b>' });
    const got = await getALinkHandler(db(), (await addLinkHandler(db(), linkInput(cat.id, 'https://b.com'))).id, true);
    // 直接查库验证转义
    const rows = await db().select().from((await import('../../src/db/schema')).links).all();
    expect(rows.some(r => r.title === '&lt;b&gt;x&lt;/b&gt;')).toBe(true);
  });
});

describe('edit_link / del_link', () => {
  it('修改后 title 更新', async () => {
    const cat = await seedCat();
    const added = await addLinkHandler(db(), linkInput(cat.id));
    await editLinkHandler(db(), added.id, { ...linkInput(cat.id), title: 'GitHub 2' });
    const got = await getALinkHandler(db(), added.id, true);
    expect(got.data!.title).toBe('GitHub 2');
  });

  it('删除后查不到', async () => {
    const cat = await seedCat();
    const added = await addLinkHandler(db(), linkInput(cat.id));
    await delLinkHandler(db(), added.id);
    const got = await getALinkHandler(db(), added.id, true);
    expect(got.code).toBe(-2000);
  });
});

describe('link_list / q_category_link（游客可见性）', () => {
  it('游客只见公开分类下的公开链接', async () => {
    const pubCat = await seedCat();
    const privCat = await addCategoryHandler(db(), { name: '私有分类', property: 1, weight: 0, description: '', font_icon: '', fid: 0 });
    await addLinkHandler(db(), linkInput(pubCat.id, 'https://a.com'));
    await addLinkHandler(db(), linkInput(privCat.id, 'https://b.com'));

    const guest = await linkListHandler(db(), 1, 10, false);
    expect(guest.count).toBe(1);
    expect(guest.data[0].url).toBe('https://a.com');

    const admin = await linkListHandler(db(), 1, 10, true);
    expect(admin.count).toBe(2);
  });

  it('私有链接对游客隐藏（链接私有、分类公开）', async () => {
    const cat = await seedCat();
    await addLinkHandler(db(), { ...linkInput(cat.id), property: 1 });
    const guest = await linkListHandler(db(), 1, 10, false);
    expect(guest.count).toBe(0);
    const admin = await linkListHandler(db(), 1, 10, true);
    expect(admin.count).toBe(1);
  });

  it('q_category_link 按分类过滤并带 categoryName', async () => {
    const cat = await seedCat();
    await addLinkHandler(db(), linkInput(cat.id, 'https://a.com'));
    const res = await qCategoryLinkHandler(db(), cat.id, 1, 10, true);
    expect(res.count).toBe(1);
    expect(res.data[0].categoryName).toBe('工具');
  });

  it('q_category_link 空 fid 返回 -2000', async () => {
    const res = await qCategoryLinkHandler(db(), 0, 1, 10, true);
    expect(res.code).toBe(-2000);
  });

  it('get_a_link 游客访问私有链接被拒', async () => {
    const cat = await seedCat();
    const added = await addLinkHandler(db(), { ...linkInput(cat.id), property: 1 });
    const guest = await getALinkHandler(db(), added.id, false);
    expect(guest.code).toBe(-1002);
    const admin = await getALinkHandler(db(), added.id, true);
    expect(admin.code).toBe(0);
  });
});
