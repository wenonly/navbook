// TEST_MIGRATIONS 绑定由 vitest.config.ts 的 miniflare.bindings 运行时注入，
// 不在 wrangler.toml 中，因此 wrangler 生成的 worker-configuration.d.ts 里没有它的类型。
// 这里对 Cloudflare.Env 做声明合并补齐（0.22.0 无 `D1Migrations` 复数类型，
// 实际形状是 `D1Migration[]`，类型从 cloudflare:test 模块导入）。
import type { D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
