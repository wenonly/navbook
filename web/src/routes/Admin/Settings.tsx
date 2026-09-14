import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/ui/PageHeader';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Loading, LoadError } from '@/components/admin/Loading';

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
  const [confirmPrivacy, setConfirmPrivacy] = useState(false);

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
  if (isError || !data?.data) return <LoadError />;
  const cfg = data.data as SiteConfigData;

  function onSaveInfo(e: React.FormEvent) {
    e.preventDefault();
    save.mutate(
      { site_title: title, site_subtitle: subtitle },
      {
        onSuccess: () => toast.success('已保存，首页刷新后生效'),
        onError: (e2: Error) => toast.error(e2.message),
      },
    );
  }

  function onTogglePrivacy() {
    const next = !cfg.site_private;
    save.mutate(
      { site_private: next ? '1' : '0' },
      {
        onSuccess: () => toast.success(next ? '隐私模式已开启' : '隐私模式已关闭'),
        onError: (e2: Error) => toast.error(e2.message),
      },
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="站点设置" subtitle="配置站点基础信息与访问策略，保存后首页刷新生效" />

      <Card className="mb-8 p-5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-medium text-ink">
            <Eye size={16} className="text-ink-secondary" />
            隐私模式
          </h3>
          <Switch
            checked={cfg.site_private}
            disabled={save.isPending}
            onCheckedChange={() => setConfirmPrivacy(true)}
            aria-label="隐私模式开关"
          />
        </div>
        <div className="mt-4 flex items-center gap-2">
          {cfg.site_private
            ? <Badge>已开启</Badge>
            : <Badge variant="secondary">已关闭</Badge>}
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
            <Button variant="outline" disabled={save.isPending} onClick={() => setConfirmPrivacy(true)}>
              <Eye size={13} />
              关闭隐私模式
            </Button>
          ) : (
            <Button disabled={save.isPending} onClick={() => setConfirmPrivacy(true)}>
              <EyeOff size={13} />
              开启隐私模式
            </Button>
          )}
        </div>
      </Card>

      <Card className="p-5">
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

      <ConfirmDialog
        open={confirmPrivacy}
        onOpenChange={setConfirmPrivacy}
        title={cfg.site_private ? '关闭隐私模式？' : '开启隐私模式？'}
        description={cfg.site_private
          ? '站点将对访客公开全部当前公开数据。'
          : '未登录访客打开首页将直接跳转登录页，公开数据 API 也一并关闭。'}
        confirmText={cfg.site_private ? '关闭' : '开启'}
        onConfirm={onTogglePrivacy}
      />
    </div>
  );
}
