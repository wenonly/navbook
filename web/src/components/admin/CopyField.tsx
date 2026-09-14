import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  label: string;
  value: string | null;
}

export function CopyField({ label, value }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* 剪贴板权限拒绝时静默 */ }
  }

  return (
    <div>
      <label className="mb-1 block text-sm text-ink-secondary">{label}</label>
      <div className="flex gap-2">
        <input
          readOnly
          value={value ?? '（未生成）'}
          className="h-9 w-full rounded-lg border border-line bg-surface px-3 font-mono text-sm text-ink"
        />
        <Button variant="outline" disabled={!value || copied} onClick={copy}>
          {copied
            ? <><Check size={13} /> 已复制</>
            : <><Copy size={13} /> 复制</>}
        </Button>
      </div>
    </div>
  );
}
