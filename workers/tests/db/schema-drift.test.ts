import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { isTable, getTableName } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

// schema.ts 导出的每张表必须存在于迁移后的实际库中（防 schema/SQL 双源漂移）。
// 注：drizzle 0.45 表对象上没有 `.name` 属性（表名在 Symbol(drizzle:Name) 上），
// 需用 isTable() 识别表对象、getTableName() 取表名。
describe('schema ↔ migration 漂移检测', () => {
  it('schema 中每张表都在库中', async () => {
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all<{ name: string }>();
    const tables = new Set((result.results ?? []).map(r => r.name));
    const expected = Object.values(schema)
      .filter(isTable)
      .map(getTableName);
    expect(expected.length).toBeGreaterThanOrEqual(6);
    for (const t of expected) {
      expect(tables.has(t), `表 ${t} 在 schema.ts 中定义但迁移未创建`).toBe(true);
    }
  });
});
