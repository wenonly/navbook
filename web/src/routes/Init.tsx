import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, KeyRound, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function Init() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // code!==0 已在 client 层抛错，走到这里即成功
      await api.init(username, password);
      navigate('/admin/login'); // 初始化只建账号；登录（下发 cookie）走 /admin/login
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#4338CA]">
      <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-primary/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-full bg-[#6366F1]/40 blur-3xl" />

      <form onSubmit={submit} className="relative w-96 rounded-2xl bg-surface p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Bookmark size={24} className="text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-bold text-ink">首次使用 · 设置管理员</h1>
            <p className="mt-0.5 text-xs text-ink-faint">创建管理员账号后进入登录页</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <UserRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input
              placeholder="用户名"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          <div className="relative">
            <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input
              type="password"
              placeholder="密码（≥6 位）"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? '初始化中...' : '初始化'}
          </Button>
        </div>
      </form>
    </div>
  );
}
