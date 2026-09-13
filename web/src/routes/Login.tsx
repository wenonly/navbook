import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Lock } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/stores/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ErrorNote } from '@/components/ui/Feedback';

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#4338CA]">
      {/* 装饰光斑 */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-primary/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-full bg-[#6366F1]/40 blur-3xl" />

      <form onSubmit={submit} className="relative w-96 rounded-2xl bg-surface p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Bookmark size={24} className="text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-bold text-ink">NavBook 管理后台</h1>
            <p className="mt-0.5 text-xs text-ink-faint">请输入管理员密码登录</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <Lock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input
              type="password"
              placeholder="密码"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" disabled={busy || !password} className="w-full">
            {busy ? '登录中...' : '登录'}
          </Button>
        </div>
      </form>
    </div>
  );
}
