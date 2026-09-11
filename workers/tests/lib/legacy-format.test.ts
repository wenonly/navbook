import { describe, it, expect } from 'vitest';
import { decodeEntities, onenavImportSchema, DEFAULT_CATEGORY_NAME } from '../../src/lib/legacy-format';

describe('decodeEntities（html_entity_decode ENT_QUOTES 等价，PHP 导出对称）', () => {
  it('五实体解码', () => {
    expect(decodeEntities('&lt;b&gt;A&amp;B&lt;/b&gt;')).toBe('<b>A&B</b>');
    expect(decodeEntities('&quot;x&quot;')).toBe('"x"');
    expect(decodeEntities('&#039;y&#039;')).toBe("'y'");
    expect(decodeEntities('&#39;z&#39;')).toBe("'z'");
  });
  it('&amp; 最后解码，避免二次解码（&amp;lt; → &lt; 字面量）', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
  });
  it('无实体原样返回', () => {
    expect(decodeEntities('普通中文 normal')).toBe('普通中文 normal');
  });
});

describe('onenavImportSchema', () => {
  const link = { title: 'A', url: 'https://a.com', description: '', backup_url: '', sort_order: 0 };
  const l2 = { name: '二级', description: '', links: [link] };
  const payload = {
    type: 'onenav.bookmarks',
    version: 1,
    categories: [{ name: '一级', description: '', links: [], children: [l2] }],
  };

  it('合法 payload 通过并补全默认值', () => {
    const parsed = onenavImportSchema.parse(payload);
    expect(parsed.type).toBe('onenav.bookmarks');
    expect(parsed.categories[0].children[0].links[0].url).toBe('https://a.com');
  });

  it('缺省字段补默认（description/backup_url/sort_order/children/links）', () => {
    const parsed = onenavImportSchema.parse({
      type: 'onenav.bookmarks',
      categories: [{ name: '一级', links: [{ title: 'A', url: 'u' }] }],
    });
    const cat = parsed.categories[0];
    expect(cat.description).toBe('');
    expect(cat.children).toEqual([]);
    expect(cat.links[0].backup_url).toBe('');
    expect(cat.links[0].sort_order).toBe(0);
  });

  it('type 不符拒绝', () => {
    expect(() => onenavImportSchema.parse({ ...payload, type: 'other' })).toThrow();
  });

  it('空 categories 拒绝（无意义导入）', () => {
    expect(() => onenavImportSchema.parse({ ...payload, categories: [] })).toThrow();
  });

  it('url 不限协议（旧书签可能有非 http scheme，与 DB 无格式约束一致）', () => {
    const parsed = onenavImportSchema.parse({
      type: 'onenav.bookmarks',
      categories: [{ name: 'x', links: [{ title: 'A', url: 'javascript:void(0)' }] }],
    });
    expect(parsed.categories[0].links[0].url).toBe('javascript:void(0)');
  });

  it('DEFAULT_CATEGORY_NAME 与 PHP 一致', () => {
    expect(DEFAULT_CATEGORY_NAME).toBe('默认分类');
  });
});
