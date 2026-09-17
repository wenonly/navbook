import React from 'react';
import ReactDOM from 'react-dom/client';
import { createApiClient } from '@navbook/shared';
import type { NavData } from '@navbook/shared';
import App from './App';
import PageSkeleton from './components/PageSkeleton';
import './index.css';

const api = createApiClient();
const root = ReactDOM.createRoot(document.getElementById('root')!);

type State =
  | { kind: 'loading' }
  | { kind: 'error'; msg: string }
  | { kind: 'ready'; data: NavData };

function Root() {
  const [state, setState] = React.useState<State>({ kind: 'loading' });

  const load = React.useCallback(() => {
    setState({ kind: 'loading' });
    api.publicNav()
      .then(data => setState({ kind: 'ready', data }))
      .catch(err => setState({ kind: 'error', msg: err instanceof Error ? err.message : '加载失败' }));
  }, []);

  // 静默刷新:右键菜单改完数据后原地更新,不闪骨架屏
  const refresh = React.useCallback(() => {
    api.publicNav()
      .then(data => setState(prev => prev.kind === 'ready' ? { ...prev, data } : prev))
      .catch(() => {});
  }, []);

  React.useEffect(load, [load]);

  if (state.kind === 'loading') return <PageSkeleton />;
  if (state.kind === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-sm rounded-card border border-border bg-card p-6 text-center shadow-card">
          <p className="text-sm text-fg">{state.msg}</p>
          <p className="mt-1 text-xs text-faint">可能是网络波动或服务暂时不可用</p>
          <button
            onClick={load}
            className="mt-4 h-9 rounded-input bg-accent px-5 text-[13px] font-medium text-white transition hover:bg-accent-strong"
          >
            重试
          </button>
        </div>
      </div>
    );
  }
  return <App data={state.data} onRefresh={refresh} />;
}

root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
