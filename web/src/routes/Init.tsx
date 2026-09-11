import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';

export function Init() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // code!==0 已在 client 层抛错，走到这里即成功
      await api.init(username, password);
      navigate('/admin/login'); // 初始化只建账号；登录（下发 cookie）走 /admin/login
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form
        onSubmit={submit}
        className="w-80 space-y-4 p-6 border rounded"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', borderRadius: 'var(--radius)' }}
      >
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>首次使用 · 设置管理员</h1>
        <input
          placeholder="用户名"
          value={username}
          onChange={e => setUsername(e.target.value)}
          className="w-full px-3 py-2 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <input
          type="password"
          placeholder="密码（≥6 位）"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full px-3 py-2 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full py-2 rounded text-white disabled:opacity-50"
          style={{ background: 'var(--color-primary)' }}
        >
          {busy ? '初始化中...' : '初始化'}
        </button>
      </form>
    </div>
  );
}
