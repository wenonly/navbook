import { useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { useThemes, useSetTheme } from '@/api/hooks';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { Loading, LoadError } from '@/components/admin/Loading';
import { ThemeCard } from '@/components/admin/ThemeCard';

export function AdminTheme() {
  const { data, isLoading, isError } = useThemes();
  const switchTheme = useSetTheme();
  const [switching, setSwitching] = useState<string | null>(null);

  if (isLoading) return <Loading />;
  if (isError || !data?.data) return <LoadError />;

  const { active, themes } = data.data;
  const activeName = themes.find(t => t.id === active)?.name ?? active;

  function onSwitch(id: string) {
    const name = themes.find(t => t.id === id)?.name ?? id;
    setSwitching(id);
    switchTheme.mutate(id, {
      onSuccess: () => {
        setSwitching(null);
        toast.success(`已切换到「${name}」，首页刷新可见`);
      },
      onError: (e: Error) => {
        setSwitching(null);
        toast.error(e.message);
      },
    });
  }

  return (
    <div className="max-w-[1180px]">
      <PageHeader
        title="主题管理"
        subtitle="切换前台展示主题，即时生效（首页刷新可见）"
        right={
          <Badge className="mt-1 h-[29px] px-3 text-[13px]">
            <CircleCheck size={14} />
            当前主题：{activeName}
          </Badge>
        }
      />
      <div className="grid gap-5 md:grid-cols-2">
        {themes.map(t => (
          <ThemeCard
            key={t.id}
            theme={t}
            active={t.id === active}
            switching={switching === t.id}
            onSwitch={onSwitch}
          />
        ))}
      </div>
      <p className="mt-6 text-xs">
        <a href="/" target="_blank" rel="noreferrer" className="text-primary hover:underline">
          查看首页 ↗
        </a>
      </p>
    </div>
  );
}
