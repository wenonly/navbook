// vitest 4 + @cloudflare/vitest-pool-workers 0.22.0 写法：
// 旧版的 `defineWorkersConfig` / `@cloudflare/vitest-pool-workers/config` 子路径
// 和 `D1_MIGRATIONS` 常量在该版本已移除，改为 `cloudflareTest()` Vite 插件 +
// `readD1Migrations()` 异步读取迁移文件（两者都从包主入口导出）。
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

// 锚定本文件位置：vitest 的 root/include/setupFiles 及 readD1Migrations 的路径
// 都相对进程 cwd 解析，从仓库根直接跑 `vitest -c workers/vitest.config.ts`
// 会 ENOENT / No test files，故一律换成绝对路径。
// 注意：vite 把本文件转译到 node_modules/.vite-temp/ 再加载，import.meta.url
// 指向临时副本（实测 ENOENT）；vite 对 config bundle define 的 __dirname 则指向
// 源文件目录（实测正确），故用后者。tsconfig 面向 workerd（无 Node 类型），
// 此处做文件级 ambient 声明。
declare const __dirname: string;

const here = (p: string) => __dirname + '/' + p.replace(/^\.\//, '');

export default defineConfig({
  root: here('.'),
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: here('../wrangler.toml') },
      miniflare: {
        // 本包内嵌的 workerd 二进制最高支持 2026-08-22，低于 wrangler.toml 的
        // 2026-09-10，此处仅对测试运行时降级覆盖（两者之间无行为差异 flag）。
        compatibilityDate: '2026-08-22',
        // 迁移经此绑定注入，由 tests/setup.ts 在 worker 内调用
        // applyD1Migrations(env.DB, env.TEST_MIGRATIONS) 应用（幂等）。
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(here('./src/db/migrations')),
        },
      },
    }),
  ],
});
