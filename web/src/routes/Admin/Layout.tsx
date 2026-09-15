import { useEffect, useState } from 'react';
import { Outlet, NavLink, Navigate, useNavigate } from 'react-router-dom';
import {
  Bookmark, Folder, Link as LinkIcon, ArrowLeftRight,
  KeyRound, Palette, Settings2, LogOut, Bot, Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { api } from '@/api/client';
import { cn } from '@/lib/utils';

const NAV_SECTIONS: Array<{ label: string; items: Array<{ to: string; label: string; icon: LucideIcon }> }> = [
  {
    label: '内容管理',
    items: [
      { to: '/admin/categories', label: '分类管理', icon: Folder },
      { to: '/admin/links', label: '链接管理', icon: LinkIcon },
      { to: '/admin/import-export', label: '导入导出', icon: ArrowLeftRight },
    ],
  },
  {
    label: '系统配置',
    items: [
      { to: '/admin/token', label: 'Token 管理', icon: KeyRound },
      { to: '/admin/theme', label: '主题管理', icon: Palette },
      { to: '/admin/settings', label: '站点设置', icon: Settings2 },
    ],
  },
  {
    label: 'AI 助手',
    items: [
      { to: '/admin/assistant', label: 'AI 助手', icon: Sparkles },
      { to: '/admin/ai-config', label: '模型配置', icon: Bot },
    ],
  },
];

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

  function logout() {
    // 服务端清 cookie（Max-Age=0）+ 前端清状态
    void api.logout().finally(() => {
      clear();
      navigate('/');
    });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-page">
      <aside className="flex w-60 shrink-0 flex-col bg-sidebar p-4">
        <div className="mb-6 flex items-center gap-3 px-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary">
            <Bookmark size={18} className="text-white" />
          </div>
          <div>
            <div className="text-[15px] font-bold leading-tight text-white">NavBook</div>
            <div className="text-[11px] text-sidebar-muted">书签导航管理后台</div>
          </div>
        </div>

        <nav className="flex-1 space-y-5">
          {NAV_SECTIONS.map(section => (
            <div key={section.label}>
              <div className="mb-1.5 px-3 text-xs text-sidebar-muted">{section.label}</div>
              <div className="space-y-0.5">
                {section.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        'flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors',
                        isActive
                          ? 'bg-primary font-medium text-white'
                          : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-white',
                      )
                    }
                  >
                    <Icon size={16} />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-divider pt-3">
          <div className="mb-1 flex items-center gap-2.5 px-3 py-1">
            <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#2A3149] text-xs font-medium text-white">
              {username.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-[13px] leading-tight text-white">{username}</div>
              <div className="text-[11px] text-sidebar-muted">管理员</div>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-[#F87171] transition-colors hover:bg-sidebar-hover"
          >
            <LogOut size={16} />
            退出登录
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
