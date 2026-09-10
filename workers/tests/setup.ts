import { applyD1Migrations, env } from 'cloudflare:test';

// 幂等：已应用的 migration（记录在 d1_migrations 表）不会重复执行。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
