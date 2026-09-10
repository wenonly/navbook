// vitest 4 + @cloudflare/vitest-pool-workers 0.22.0 写法：
// 旧版的 `defineWorkersConfig` / `@cloudflare/vitest-pool-workers/config` 子路径
// 和 `D1_MIGRATIONS` 常量在该版本已移除，改为 `cloudflareTest()` Vite 插件 +
// `readD1Migrations()` 异步读取迁移文件（两者都从包主入口导出）。
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // 本包内嵌的 workerd 二进制最高支持 2026-08-22，低于 wrangler.toml 的
        // 2026-09-10，此处仅对测试运行时降级覆盖（两者之间无行为差异 flag）。
        compatibilityDate: '2026-08-22',
        // 迁移经此绑定注入，由 tests/setup.ts 在 worker 内调用
        // applyD1Migrations(env.DB, env.TEST_MIGRATIONS) 应用（幂等）。
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('./src/db/migrations'),
        },
      },
    }),
  ],
});
