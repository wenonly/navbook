import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

interface ThemeEntry {
  id: string; name: string; version: string;
  author: string; description: string;
}

export function AdminTheme() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['themes'], queryFn: api.themes });
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState<string | null>(null);

  const switchTheme = useMutation({
    mutationFn: (id: string) => api.setTheme(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['themes'] }),
  });

  if (isLoading) return <div>加载中...</div>;
  if (isError || !data?.data) return <div>加载失败，请刷新重试</div>;

  const { active, themes } = data.data as { active: string; themes: ThemeEntry[] };

  function onSwitch(id: string) {
    setError('');
    setSwitching(id);
    switchTheme.mutate(id, {
      onSuccess: () => setSwitching(null),
      onError: (e: Error) => { setSwitching(null); setError(e.message); },
    });
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>主题管理</h2>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-subtle)' }}>
        当前主题：<strong>{active}</strong>——切换即时生效（首页刷新可见）。
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {themes.map(t => (
          <div
            key={t.id}
            className="p-4 border rounded"
            style={{
              borderColor: t.id === active ? 'var(--color-primary)' : 'var(--color-border)',
              borderWidth: t.id === active ? 2 : 1,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium" style={{ color: 'var(--color-text)' }}>{t.name}</h3>
              <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>v{t.version}</span>
            </div>
            <p className="text-xs mb-1" style={{ color: 'var(--color-text-subtle)' }}>{t.description || '—'}</p>
            <p className="text-xs mb-3" style={{ color: 'var(--color-text-subtle)' }}>by {t.author}</p>
            <button
              type="button"
              disabled={t.id === active || switching === t.id}
              onClick={() => onSwitch(t.id)}
              className="px-3 py-1 rounded text-sm text-white disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              {t.id === active ? '当前主题' : switching === t.id ? '切换中...' : '启用'}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
      <p className="text-xs mt-6">
        <a href="/" target="_blank" style={{ color: 'var(--color-primary)' }}>查看首页 ↗</a>
      </p>
    </div>
  );
}
