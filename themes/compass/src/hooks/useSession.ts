import { useEffect, useState } from 'react';
import { createApiClient } from '@navbook/shared';
import type { SessionInfo } from '@navbook/shared';

const api = createApiClient({ onUnauthorized: false });

/** 登录态：失败/未登录一律视为游客，不阻塞页面 */
export function useSession() {
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .session()
      .then(res => alive && setSession(res.data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return session;
}
