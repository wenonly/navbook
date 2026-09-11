import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export function AdminToken() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['tokenInfo'], queryFn: api.tokenInfo });
  const [copied, setCopied] = useState<string | null>(null);

  const regen = useMutation({
    mutationFn: api.createSk,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tokenInfo'] }),
  });

  if (isLoading) return <div>加载中...</div>;
  if (isError || !data?.data) return <div>加载失败，请刷新重试</div>;

  const { username, secret_key: sk, token } = data.data;

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* 剪贴板权限拒绝时静默 */ }
  }

  function Field({ label, value }: { label: string; value: string | null }) {
    return (
      <div className="mb-4">
        <label className="block text-sm mb-1" style={{ color: 'var(--color-text-subtle)' }}>{label}</label>
        <div className="flex gap-2">
          <input
            readOnly
            value={value ?? '（未生成）'}
            className="flex-1 px-3 py-2 border rounded font-mono text-sm bg-transparent"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <button
            type="button"
            disabled={!value || copied === label}
            onClick={() => value && copy(value, label)}
            className="px-4 py-2 border rounded text-sm disabled:opacity-50"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            {copied === label ? '已复制' : '复制'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>Token 管理</h2>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-subtle)' }}>
        浏览器插件对接：API 地址填本站域名，Token 填下方 X-Token（用户名「{username}」）。
      </p>

      <Field label="X-Token（插件用）" value={token} />
      <Field label="SecretKey（构成 token 的密钥）" value={sk} />

      <div className="mt-8 p-4 border rounded" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-sm mb-3" style={{ color: 'var(--color-text-subtle)' }}>
          重新生成后旧 X-Token 立即失效，所有已配置的插件都需要更新。
        </p>
        <button
          type="button"
          disabled={regen.isPending}
          onClick={() => {
            if (confirm('确定重新生成 SecretKey？旧 Token 将立即失效。')) regen.mutate();
          }}
          className="px-4 py-2 rounded text-sm text-white disabled:opacity-50"
          style={{ background: 'var(--color-primary)' }}
        >
          {regen.isPending ? '生成中...' : '重新生成 SecretKey'}
        </button>
      </div>
    </div>
  );
}
