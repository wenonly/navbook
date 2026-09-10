import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

export const corsMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Token, Authorization, X-Cid',
        'Access-Control-Expose-Headers': 'X-Token',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-Token, Authorization, X-Cid');
  c.header('Access-Control-Expose-Headers', 'X-Token');
};
