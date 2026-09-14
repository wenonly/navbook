import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, RefreshCw } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/legacy/Button';
import { Card } from '@/components/legacy/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorNote, Loading } from '@/components/legacy/Feedback';
import { CopyField } from '@/components/admin/CopyField';

export function AdminToken() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['tokenInfo'], queryFn: api.tokenInfo });

  const regen = useMutation({
    mutationFn: api.createSk,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tokenInfo'] }),
  });

  if (isLoading) return <Loading />;
  if (isError || !data?.data) return <ErrorNote>加载失败，请刷新重试</ErrorNote>;

  const { username, secret_key: sk, token } = data.data;

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Token 管理"
        subtitle={`浏览器插件对接：API 地址填本站域名，Token 填下方 X-Token（用户名「${username}」）。`}
      />

      <Card className="mb-8 space-y-5">
        <CopyField label="X-Token（插件用）" value={token} />
        <CopyField label="SecretKey（构成 token 的密钥）" value={sk} />
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2 text-danger">
          <KeyRound size={16} />
          <span className="font-medium">重新生成 SecretKey</span>
        </div>
        <p className="mb-4 text-sm text-ink-secondary">
          重新生成后旧 X-Token 立即失效，所有已配置的插件都需要更新。
        </p>
        <Button
          variant="danger"
          disabled={regen.isPending}
          onClick={() => {
            if (confirm('确定重新生成 SecretKey？旧 Token 将立即失效。')) regen.mutate();
          }}
        >
          <RefreshCw size={13} />
          {regen.isPending ? '生成中...' : '重新生成 SecretKey'}
        </Button>
      </Card>
    </div>
  );
}
