import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

interface SiteConfigData {
  site_private: boolean;
  site_title: string;
  site_subtitle: string;
}

export function AdminSettings() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['siteConfig'], queryFn: api.siteConfig });
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (data?.data) {
      setTitle(data.data.site_title);
      setSubtitle(data.data.site_subtitle);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.setSite(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['siteConfig'] }),
  });

  if (isLoading) return <div>加载中...</div>;
  if (isError || !data?.data) return <div>加载失败，请刷新重试</div>;
  const cfg = data.data as SiteConfigData;

  function onSaveInfo(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setMsg('');
    save.mutate(
      { site_title: title, site_subtitle: subtitle },
      { onSuccess: () => setMsg('已保存，首页刷新后生效'), onError: (e2: Error) => setError(e2.message) },
    );
  }

  function onTogglePrivacy() {
    const next = !cfg.site_private;
    if (!confirm(next
      ? '开启隐私模式？未登录访客打开首页将直接跳转登录页，公开数据 API 也一并关闭。'
      : '关闭隐私模式？站点将对访客公开全部当前公开数据。')) return;
    setError(''); setMsg('');
    save.mutate(
      { site_private: next ? '1' : '0' },
      { onSuccess: () => setMsg(next ? '隐私模式已开启' : '隐私模式已关闭'), onError: (e2: Error) => setError(e2.message) },
    );
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-bold mb-6" style={{ color: 'var(--color-text)' }}>站点设置</h2>

      <section className="mb-8 p-4 border rounded" style={{ borderColor: 'var(--color-border)' }}>
        <h3 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>隐私模式</h3>
        <p className="text-sm mb-3" style={{ color: 'var(--color-text-subtle)' }}>
          当前状态：<strong style={{ color: cfg.site_private ? 'var(--color-primary)' : 'inherit' }}>
            {cfg.site_private ? '已开启（访客需登录）' : '未开启（站点公开）'}
          </strong>
        </p>
        <button
          type="button"
          disabled={save.isPending}
          onClick={onTogglePrivacy}
          className="px-4 py-2 rounded text-sm text-white disabled:opacity-50"
          style={{ background: cfg.site_private ? 'var(--color-text-subtle)' : 'var(--color-primary)' }}
        >
          {cfg.site_private ? '关闭隐私模式' : '开启隐私模式'}
        </button>
      </section>

      <section className="p-4 border rounded" style={{ borderColor: 'var(--color-border)' }}>
        <h3 className="font-medium mb-3" style={{ color: 'var(--color-text)' }}>站点信息</h3>
        <form onSubmit={onSaveInfo} className="space-y-3">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="站点标题"
            className="w-full px-3 py-2 border rounded"
            style={{ borderColor: 'var(--color-border)' }}
          />
          <input
            value={subtitle}
            onChange={e => setSubtitle(e.target.value)}
            placeholder="副标题（可选）"
            className="w-full px-3 py-2 border rounded"
            style={{ borderColor: 'var(--color-border)' }}
          />
          <button
            type="submit"
            disabled={save.isPending || !title.trim()}
            className="px-4 py-2 rounded text-sm text-white disabled:opacity-50"
            style={{ background: 'var(--color-primary)' }}
          >
            {save.isPending ? '保存中...' : '保存'}
          </button>
        </form>
      </section>

      {msg && <p className="text-green-600 text-sm mt-4">{msg}</p>}
      {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
    </div>
  );
}
