import React from 'react';
import ReactDOM from 'react-dom/client';
import { createApiClient } from '@navbook/shared';
import type { NavData, SessionInfo } from '@navbook/shared';
import App from './App';
import './index.css';

const api = createApiClient({ onUnauthorized: false });
const root = ReactDOM.createRoot(document.getElementById('root')!);

type State =
  | { kind: 'loading' }
  | { kind: 'error'; msg: string }
  | { kind: 'ready'; data: NavData; session: SessionInfo | null };

function Root() {
  const [state, setState] = React.useState<State>({ kind: 'loading' });

  const load = React.useCallback(() => {
    setState({ kind: 'loading' });
    Promise.all([api.publicNav(), api.session()])
      .then(([data, sess]) => setState({ kind: 'ready', data, session: sess.data }))
      .catch(err => setState({ kind: 'error', msg: err instanceof Error ? err.message : '加载失败' }));
  }, []);

  React.useEffect(load, [load]);

  if (state.kind === 'loading') {
    return <p className="gz-loading">排印中 …</p>;
  }
  if (state.kind === 'error') {
    return (
      <div className="gz-loading">
        <p style={{ color: 'var(--ink)' }}>{state.msg}</p>
        <button
          onClick={load}
          className="gz-chip"
          style={{ marginTop: '1rem' }}
        >
          重新排版
        </button>
      </div>
    );
  }
  return <App data={state.data} session={state.session} />;
}

root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
