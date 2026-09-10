import type { ErrorHandler } from 'hono';
import type { AppEnv } from '../types';

/**
 * 统一错误出口：业务错误（handler 主动 throw 的 Error）返回 200 + 错误码，与 PHP 版行为一致。
 *
 * 注意：必须经 app.onError() 注册（见 router.ts），不能用「try { await next() } catch」式
 * 中间件兜底——Hono 的 compose 会在抛错的那一层就地调用 errorHandler（默认实现是
 * console.error + 500 文本），异常不会以 rejection 形式冒泡到最外层中间件的 catch。
 */
export const onErrorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const msg = err instanceof Error ? err.message : 'Internal Server Error';
  console.error('Unhandled error:', err);
  return c.json({ code: -2000, msg });
};
