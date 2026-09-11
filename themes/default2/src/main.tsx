import React from 'react';
import ReactDOM from 'react-dom/client';
import { createApiClient } from '@navbook/shared';
import type { NavData } from '@navbook/shared';
import App from './App';
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

  React.useEffect(load, [load]);

  if (state.kind === 'loading') {
    return <div className="p-8" style={{ color: 'var(--color-text-subtle)' }}>加载中...</div>;
  }
  if (state.kind === 'error') {
    return (
      <div className="p-8">
        <p style={{ color: 'var(--color-text)' }}>{state.msg}</p>
        <button
          onClick={load}
          className="mt-2 px-4 py-1 rounded text-white"
          style={{ background: 'var(--color-primary)' }}
        >
          重试
        </button>
      </div>
    );
  }
  return <App data={state.data} />;
}

root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
