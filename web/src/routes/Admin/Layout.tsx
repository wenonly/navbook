import { useEffect, useState } from 'react';
import { Outlet, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { api } from '@/api/client';

export function AdminLayout() {
  const username = useAuth(s => s.username);
  const setUsername = useAuth(s => s.setUsername);
  const clear = useAuth(s => s.clear);
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api.session().then(res => {
      if (res?.data?.username) setUsername(res.data.username);
      else clear();
      setChecked(true);
    }).catch(() => {
      // 网络错误时不能带着过期的持久化 username 进后台
      clear();
      setChecked(true);
    });
  }, [setUsername, clear]);

  if (!checked) return null; // 等待会话探测，避免闪烁跳转
  if (!username) return <Navigate to="/admin/login" replace />;

  return (
    <div className="min-h-screen flex">
      <aside className="w-48 border-r p-4" style={{ borderColor: 'var(--color-border)' }}>
        <h1 className="font-bold mb-4" style={{ color: 'var(--color-text)' }}>NavBook 后台</h1>
        <nav className="space-y-2 text-sm">
          <NavLink
            to="/admin/categories"
            className={({ isActive }) => (isActive ? 'font-bold' : '')}
            style={{ color: 'var(--color-text)' }}
          >
            分类管理
          </NavLink>
          <br />
          <NavLink
            to="/admin/links"
            className={({ isActive }) => (isActive ? 'font-bold' : '')}
            style={{ color: 'var(--color-text)' }}
          >
            链接管理
          </NavLink>
          <br />
          <NavLink
            to="/admin/token"
            className={({ isActive }) => (isActive ? 'font-bold' : '')}
            style={{ color: 'var(--color-text)' }}
          >
            Token 管理
          </NavLink>
          <br />
          <NavLink
            to="/admin/import-export"
            className={({ isActive }) => (isActive ? 'font-bold' : '')}
            style={{ color: 'var(--color-text)' }}
          >
            导入导出
          </NavLink>
          <br />
          <NavLink
            to="/admin/theme"
            className={({ isActive }) => (isActive ? 'font-bold' : '')}
            style={{ color: 'var(--color-text)' }}
          >
            主题管理
          </NavLink>
          <br />
          <button
            className="text-red-500"
            onClick={() => {
              // 服务端清 cookie（Max-Age=0）+ 前端清状态
              void api.logout().finally(() => {
                clear();
                navigate('/');
              });
            }}
          >
            退出
          </button>
        </nav>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
