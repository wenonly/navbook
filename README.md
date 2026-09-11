# NavBook

跑在 Cloudflare Workers 上的书签导航站（OneNav 的 Workers 重构版）。API 兼容 OneNav 浏览器插件（X-Token）。

## 结构

- `workers/` — API（Hono + D1 + Drizzle），并把首页路由到当前主题
- `web/` — 管理后台 SPA（/admin）
- `themes/` — 独立主题项目（default2 卡片网格 / minima 紧凑列表），产物即分发单元
- `shared/` — 类型与 API client 契约包（@navbook/shared）

## 开发

    pnpm install
    pnpm dev                                  # wrangler(8787) + web(5173)
    pnpm --filter @navbook/theme-default2 dev # 单主题热更(5174)
    pnpm test

首次本地运行：`pnpm -C workers db:migrate:local` 建本地 D1。

## 部署

    pnpm deploy        # 构建全部包 + 聚合到 workers/dist + wrangler deploy

首次部署需：`wrangler d1 create onenav-db` + `wrangler d1 migrations apply onenav-db --remote` + wrangler.toml 配 database_id 与 routes（自定义域名）。

## 数据迁移

从旧 OneNav（PHP）导出 JSON → 后台「导入导出」页导入（格式 `onenav.bookmarks` 互通；同名分类合并、重复 URL 跳过）。

## 主题开发

复制 `themes/default2` 改名（package.json / vite base / theme.json / App.tsx），`pnpm build` 自动聚合进 manifest，后台即可切换。
