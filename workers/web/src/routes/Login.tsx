import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useAuth } from '@/stores/auth';

export function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const setUsername = useAuth(s => s.setUsername);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.login(password);
      // code!==0 已在 client 层抛错，走到这里即成功；cookie 由服务端 Set-Cookie 下发（HttpOnly）
      setUsername(res.data.username);
      navigate('/admin');
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
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>登录</h1>
        <input
          type="password"
          placeholder="密码"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full px-3 py-2 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
          autoFocus
        />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full py-2 rounded text-white disabled:opacity-50"
          style={{ background: 'var(--color-primary)' }}
        >
          {busy ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  );
}
