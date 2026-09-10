import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import {
  addCategoryHandler, editCategoryHandler, delCategoryHandler,
  categoryListHandler, getACategoryHandler,
} from '../../src/handlers/category';
import { addLinkHandler } from '../../src/handlers/link';
import { categorys } from '../../src/db/schema';
import { resetTables } from '../helpers';

beforeEach(async () => {
  await resetTables();
});

const db = () => getDb(env.DB);

const catInput = (name: string, fid = 0) => ({
  name, property: 0, weight: 0, description: '', font_icon: '', fid,
});

describe('add_category', () => {
  it('新增成功返回 id', async () => {
    const res = await addCategoryHandler(db(), catInput('工具'));
    expect(res.code).toBe(0);
    expect(res.id).toBeGreaterThan(0);
  });

  it('空名称抛出中文错误', async () => {
    await expect(addCategoryHandler(db(), catInput(''))).rejects.toThrow('分类名称不能为空');
  });

  it('重名抛出 Categorie already exist!（PHP 原文，含拼写）', async () => {
    await addCategoryHandler(db(), catInput('工具'));
    await expect(addCategoryHandler(db(), catInput('工具'))).rejects.toThrow('Categorie already exist!');
  });

  it('HTML 注入被转义', async () => {
    await addCategoryHandler(db(), catInput('<script>x</script>'));
    const row = await db().select().from(categorys).get();
    expect(row!.name).toBe('&lt;script&gt;x&lt;/script&gt;');
  });
});

describe('edit_category', () => {
  it('父分类不存在时报错', async () => {
    const top = await addCategoryHandler(db(), catInput('一级'));
    await expect(editCategoryHandler(db(), top.id, { ...catInput('x', 99999) }))
      .rejects.toThrow('父级ID不存在');
  });

  it('父分类不能是二级分类', async () => {
    const top = await addCategoryHandler(db(), catInput('一级'));
    const sub = await addCategoryHandler(db(), catInput('二级', top.id));
    await expect(editCategoryHandler(db(), top.id, { ...catInput('x', sub.id) }))
      .rejects.toThrow('父分类不能是二级分类');
  });

  it('有子分类时不能改为二级', async () => {
    const top = await addCategoryHandler(db(), catInput('一级'));
    await addCategoryHandler(db(), catInput('二级', top.id));
    const other = await addCategoryHandler(db(), catInput('另一个顶级'));
    await expect(editCategoryHandler(db(), top.id, { ...catInput('一级', other.id) }))
      .rejects.toThrow('子分类');
  });

  it('正常更新成功', async () => {
    const top = await addCategoryHandler(db(), catInput('一级'));
    const res = await editCategoryHandler(db(), top.id, { ...catInput('改名'), property: 1 });
    expect(res.code).toBe(0);
    const row = await db().select().from(categorys).get();
    expect(row!.name).toBe('改名');
    expect(row!.property).toBe(1);
  });

  it('edit 重名返回 PHP 原文', async () => {
    await addCategoryHandler(db(), catInput('工具'));
    const second = await addCategoryHandler(db(), catInput('工具2'));
    await expect(editCategoryHandler(db(), second.id, catInput('工具')))
      .rejects.toThrow('already exists');
  });
});

describe('del_category', () => {
  it('有子分类时拒绝删除', async () => {
    const top = await addCategoryHandler(db(), catInput('一级'));
    await addCategoryHandler(db(), catInput('二级', top.id));
    await expect(delCategoryHandler(db(), top.id)).rejects.toThrow('子分类');
  });

  it('空分类删除成功', async () => {
    const cat = await addCategoryHandler(db(), catInput('工具'));
    const res = await delCategoryHandler(db(), cat.id);
    expect(res.code).toBe(0);
  });

  it('分类不存在时报错', async () => {
    await expect(delCategoryHandler(db(), 999)).rejects.toThrow('does not exist');
  });

  it('有链接时拒绝删除', async () => {
    const cat = await addCategoryHandler(db(), catInput('工具'));
    await addLinkHandler(db(), {
      fid: cat.id, title: 'GitHub', url: 'https://github.com',
      description: '', weight: 0, property: 0, url_standby: '', font_icon: '',
    });
    await expect(delCategoryHandler(db(), cat.id)).rejects.toThrow('存在链接');
  });
});

describe('category_list', () => {
  it('游客只见公开分类，登录后见全部', async () => {
    await addCategoryHandler(db(), catInput('公开'));
    await addCategoryHandler(db(), { ...catInput('私有'), property: 1 });

    const guest = await categoryListHandler(db(), 1, 10, false);
    expect(guest.count).toBe(1);
    expect(guest.data[0].name).toBe('公开');

    const admin = await categoryListHandler(db(), 1, 10, true);
    expect(admin.count).toBe(2);
  });
});

describe('get_a_category', () => {
  it('按 ID 返回分类', async () => {
    const cat = await addCategoryHandler(db(), catInput('工具'));
    const res = await getACategoryHandler(db(), cat.id, true);
    expect(res.code).toBe(0);
    expect(res.data!.name).toBe('工具');
  });

  it('不存在返回 -2000', async () => {
    const res = await getACategoryHandler(db(), 999, true);
    expect(res.code).toBe(-2000);
  });

  it('游客请求私有分类被拒', async () => {
    const priv = await addCategoryHandler(db(), { ...catInput('私有'), property: 1 });
    const guest = await getACategoryHandler(db(), priv.id, false);
    expect(guest.code).toBe(-1002);
    const admin = await getACategoryHandler(db(), priv.id, true);
    expect(admin.code).toBe(0);
  });
});
