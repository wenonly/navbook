import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Lock, LogIn, Eye, EyeOff } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/stores/auth';
import { ErrorNote } from '@/components/legacy/Feedback';

export function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-[#E9EBF4] to-[#F6F7FA]">
      {/* 装饰圆：右上靛蓝、左下天蓝 */}
      <div className="pointer-events-none absolute -right-[120px] -top-[140px] h-[640px] w-[640px] rounded-full bg-[#C7D2FE]/45" />
      <div className="pointer-events-none absolute -bottom-[156px] -left-[180px] h-[560px] w-[560px] rounded-full bg-[#BAE6FD]/35" />

      <form
        onSubmit={submit}
        className="relative flex w-[400px] flex-col items-center gap-[22px] rounded-2xl border border-white bg-surface p-9 shadow-[0_16px_48px_rgba(26,31,53,0.08)]"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-primary">
            <Bookmark size={24} className="text-white" />
          </div>
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-xl font-bold tracking-[0.3px] text-ink">NavBook</h1>
            <p className="text-[13px] text-ink-secondary">输入管理员密码进入后台</p>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2">
          <label htmlFor="login-password" className="text-xs font-medium text-ink-secondary">访问密码</label>
          <div className="flex h-[42px] items-center gap-2.5 rounded-lg border border-line bg-surface px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary-soft">
            <Lock size={15} className="shrink-0 text-ink-faint" />
            <input
              id="login-password"
              type={show ? 'text' : 'password'}
              placeholder="请输入密码"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
              autoFocus
            />
            <button
              type="button"
              aria-label={show ? '隐藏密码' : '显示密码'}
              onClick={() => setShow(!show)}
              className="shrink-0 text-ink-faint transition-colors hover:text-ink-secondary"
            >
              {show ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
          </div>
        </div>

        {error && <div className="w-full"><ErrorNote>{error}</ErrorNote></div>}

        <button
          type="submit"
          disabled={busy || !password}
          className="flex h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogIn size={15} />
          {busy ? '登录中...' : '登录'}
        </button>

        <p className="text-center text-[11px] text-ink-faint">首次部署请通过初始化页面设置管理员密码</p>
      </form>

      <footer className="absolute inset-x-0 bottom-6 text-center text-xs text-ink-faint">
        NavBook · 轻量书签导航系统
      </footer>
    </div>
  );
}
