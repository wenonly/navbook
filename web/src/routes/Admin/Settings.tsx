import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cx } from '@/components/ui/cx';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorNote, Loading, SuccessNote } from '@/components/ui/Feedback';

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

  if (isLoading) return <Loading />;
  if (isError || !data?.data) return <ErrorNote>加载失败，请刷新重试</ErrorNote>;
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
      <PageHeader title="站点设置" subtitle="配置站点基础信息与访问策略，保存后首页刷新生效" />

      <Card className="mb-8">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-medium text-ink">
            <Eye size={16} className="text-ink-secondary" />
            隐私模式
          </h3>
          <button
            type="button"
            role="switch"
            aria-checked={cfg.site_private}
            aria-label="隐私模式开关"
            disabled={save.isPending}
            onClick={onTogglePrivacy}
            className={cx(
              'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              cfg.site_private ? 'bg-primary' : 'bg-line',
            )}
          >
            <span
              className={cx(
                'absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-all',
                cfg.site_private ? 'left-[23px]' : 'left-[3px]',
              )}
            />
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Badge tone={cfg.site_private ? 'primary' : 'neutral'}>
            {cfg.site_private ? '已开启' : '已关闭'}
          </Badge>
          <span className="text-xs text-ink-secondary">
            {cfg.site_private
              ? '未登录访客打开首页将直接跳转登录页，公开数据 API 一并关闭'
              : '站点当前公开，访客无需登录即可浏览全部公开数据'}
          </span>
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          {cfg.site_private
            ? '关闭隐私模式后，站点将对访客公开全部当前公开数据。'
            : '开启隐私模式后，未登录访客打开首页将直接跳转登录页，公开数据 API 一并关闭。'}
        </p>
        <div className="mt-4">
          {cfg.site_private ? (
            <Button variant="outline" disabled={save.isPending} onClick={onTogglePrivacy}>
              <Eye size={13} />
              关闭隐私模式
            </Button>
          ) : (
            <Button disabled={save.isPending} onClick={onTogglePrivacy}>
              <EyeOff size={13} />
              开启隐私模式
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 font-medium text-ink">站点信息</h3>
        <form onSubmit={onSaveInfo} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink-secondary">站点标题</span>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="站点标题"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-secondary">副标题（选填）</span>
            <Input
              value={subtitle}
              onChange={e => setSubtitle(e.target.value)}
              placeholder="副标题（可选）"
            />
          </label>
          <Button type="submit" disabled={save.isPending || !title.trim()}>
            {save.isPending ? '保存中...' : '保存'}
          </Button>
        </form>
      </Card>

      <div className="mt-4 space-y-1">
        {msg && <SuccessNote>{msg}</SuccessNote>}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </div>
  );
}
