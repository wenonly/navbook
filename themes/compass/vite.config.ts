import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { navFixture } from './mock/nav.ts';

/**
 * dev mock：拦截 /api 返回固定数据，主题可脱离 wrangler 独立开发。
 * 需要连真实 worker 时：NAVBOOK_PROXY=1 pnpm dev（走下方 proxy）。
 * 预览登录态：/api/session?user=admin。
 */
function mockApi(): Plugin {
  const send = (res: ServerResponse, data: unknown) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 0, data }));
  };
  return {
    name: 'navbook-mock-api',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();
        if (url.startsWith('/api/public_nav')) return send(res, navFixture);
        if (url.startsWith('/api/session')) {
          const user = new URL(url, 'http://localhost').searchParams.get('user');
          return send(res, { username: user });
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), mockApi()],
  base: '/themes/compass/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:8787' },
  },
});
