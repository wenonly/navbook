// 纯渲染:吃 ChatSnapshot.items,输出聊天气泡/思考折叠块/工具卡/确认卡。
import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import type { UiItem } from '@navbook/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ChatMessages({
  items, streaming, onConfirm,
}: {
  items: UiItem[]; streaming: boolean;
  onConfirm: (messageId: number, action: 'approve' | 'reject') => void;
}) {
  return (
    <div className="space-y-4">
      {items.map((item, i) => {
        if (item.kind === 'user') {
          return (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
                {item.text}
              </div>
            </div>
          );
        }
        if (item.kind === 'assistant') return <AssistantBubble key={i} item={item} />;
        return <ToolCard key={i} item={item} onConfirm={onConfirm} />;
      })}
      {streaming && items.at(-1)?.kind !== 'assistant' && (
        <div className="text-xs text-muted-foreground">思考中…</div>
      )}
    </div>
  );
}

function AssistantBubble({ item }: { item: Extract<UiItem, { kind: 'assistant' }> }) {
  const [openThinking, setOpenThinking] = useState(false);
  return (
    <div className="space-y-2">
      {item.reasoning && (
        <div className="rounded-lg border border-dashed border-border bg-muted/40">
          <button
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground"
            onClick={() => setOpenThinking(v => !v)}
          >
            {openThinking ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            思考过程
          </button>
          {openThinking && (
            <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap px-3 pb-2 text-xs text-muted-foreground">
              {item.reasoning}
            </pre>
          )}
        </div>
      )}
      <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
        {item.text || (item.streaming ? '…' : '')}
      </div>
    </div>
  );
}

const TOOL_STATUS = {
  running: { label: '执行中', cls: 'text-muted-foreground', Icon: Wrench },
  ok: { label: '完成', cls: 'text-emerald-600', Icon: CheckCircle2 },
  error: { label: '失败', cls: 'text-destructive', Icon: XCircle },
  rejected: { label: '已取消', cls: 'text-muted-foreground', Icon: XCircle },
  pending: { label: '待确认', cls: 'text-amber-600', Icon: ShieldAlert },
} as const;

function ToolCard({
  item, onConfirm,
}: {
  item: Extract<UiItem, { kind: 'tool' }>;
  onConfirm: (messageId: number, action: 'approve' | 'reject') => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const st = TOOL_STATUS[item.status];
  return (
    <div className={cn('max-w-[85%] rounded-xl border px-3.5 py-2.5 text-sm',
      item.status === 'pending' ? 'border-amber-500/60 bg-amber-500/5' : 'border-border bg-background')}>
      <div className="flex items-center gap-2 text-xs">
        <st.Icon size={14} className={st.cls} />
        <span className="font-medium">{item.name}</span>
        <span className={st.cls}>{st.label}</span>
        {item.status !== 'pending' && (
          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setShowRaw(v => !v)}>
            {showRaw ? '收起' : '详情'}
          </button>
        )}
      </div>
      {item.summary && <div className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{item.summary}</div>}
      {showRaw && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed">
          {JSON.stringify({ args: item.args, result: item.data }, null, 2)}
        </pre>
      )}
      {item.status === 'pending' && item.messageId != null && (
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" onClick={() => onConfirm(item.messageId!, 'approve')}>确认执行</Button>
          <Button size="sm" variant="outline" onClick={() => onConfirm(item.messageId!, 'reject')}>取消</Button>
        </div>
      )}
    </div>
  );
}
