import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

export const errorMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  try {
    await next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal Server Error';
    console.error('Unhandled error:', err);
    // 业务错误（handler 主动 throw 的 Error）返回 200 + 错误码，与 PHP 版行为一致
    return c.json({ code: -2000, msg });
  }
};
