import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { isTable, getTableName } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

// schema.ts 导出的每张表必须与迁移后的实际库结构互相覆盖（防 schema/SQL 双源漂移）。
// 注：drizzle 0.45 表对象上没有 `.name` 属性（表名在 Symbol(drizzle:Name) 上），
// 需用 isTable() 识别表对象、getTableName() 取表名。
const schemaTables: string[] = Object.values(schema)
  .filter(isTable)
  .map(getTableName);

/** D1/SQLite 内部表（迁移状态、自增序列、Cloudflare 元数据），不算业务表 */
const INTERNAL_TABLE = /^(d1_migrations|sqlite_sequence|sqlite_autoindex.*|_cf_.*)$/;

async function dbTables(): Promise<Set<string>> {
  const result = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all<{ name: string }>();
  return new Set((result.results ?? []).map(r => r.name));
}

describe('schema ↔ migration 漂移检测', () => {
  it('schema 中每张表都在库中', async () => {
    const tables = await dbTables();
    expect(schemaTables.length).toBeGreaterThanOrEqual(6);
    for (const t of schemaTables) {
      expect(tables.has(t), `表 ${t} 在 schema.ts 中定义但迁移未创建`).toBe(true);
    }
  });

  it('库中每个业务表都在 schema 导出中', async () => {
    const tables = await dbTables();
    const business = [...tables].filter((t) => !INTERNAL_TABLE.test(t));
    for (const t of business) {
      expect(
        schemaTables.includes(t),
        `表 ${t} 由迁移创建但 schema.ts 未导出`
      ).toBe(true);
    }
  });
});
