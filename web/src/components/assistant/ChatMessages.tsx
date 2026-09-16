// 纯渲染:吃 ChatSnapshot.items,输出聊天气泡/思考折叠块/工具卡/确认卡 + streaming 状态条。
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, ShieldAlert, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import type { UiItem } from '@navbook/shared';
import { activityLabel } from '@navbook/shared';
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
        if (item.kind === 'error') {
          return (
            <div key={i} className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {item.text}
            </div>
          );
        }
        if (item.kind === 'assistant') return <AssistantBubble key={i} item={item} />;
        return <ToolCard key={i} item={item} onConfirm={onConfirm} />;
      })}
      {streaming && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" />
          <span className="animate-pulse">
            {activityLabel({ items, streaming })}
          </span>
        </div>
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
      <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5">
        {item.text ? <Markdown text={item.text} /> : (item.streaming ? '…' : '')}
      </div>
    </div>
  );
}

/** assistant 消息 Markdown 渲染(react-markdown 默认不渲染原始 HTML,无 XSS 面) */
function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a href={props.href} target="_blank" rel="noreferrer"
            className="text-primary underline underline-offset-2">{props.children}</a>,
          p: ({ children }) => <p className="mb-2">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc pl-5 [&_li]:mt-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal pl-5 [&_li]:mt-0.5">{children}</ol>,
          h1: ({ children }) => <h1 className="mb-2 text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 text-sm font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 text-sm font-semibold">{children}</h3>,
          blockquote: ({ children }) => <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
          table: ({ children }) => <table className="mb-2 w-full border-collapse text-xs [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1">{children}</table>,
          pre: ({ children }) => <pre className="mb-2 max-w-full overflow-x-auto rounded-md bg-background p-2.5 text-xs [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
          code: ({ children }) => <code className="rounded bg-background px-1 py-0.5 font-mono text-[13px]">{children}</code>,
          hr: () => <hr className="my-2 border-border" />,
        }}
      >{text}</ReactMarkdown>
    </div>
  );
}

const TOOL_STATUS = {
  running: { label: '执行中', cls: 'text-muted-foreground', Icon: Loader2, spin: true },
  ok: { label: '完成', cls: 'text-emerald-600', Icon: CheckCircle2, spin: false },
  error: { label: '失败', cls: 'text-destructive', Icon: XCircle, spin: false },
  rejected: { label: '已取消', cls: 'text-muted-foreground', Icon: XCircle, spin: false },
  pending: { label: '待确认', cls: 'text-amber-600', Icon: ShieldAlert, spin: false },
} as const;

/** running 卡的秒计时(本地 1s 跳,不打扰 machine) */
function Elapsed({ startedAt }: { startedAt?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (startedAt == null) return null;
  return <span> · {Math.max(0, Math.floor((now - startedAt) / 1000))}s</span>;
}

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
        <st.Icon size={14} className={cn(st.cls, st.spin && 'animate-spin')} />
        <span className="font-medium">{item.name}</span>
        <span className={st.cls}>
          {st.label}
          {item.status === 'running' && <Elapsed startedAt={item.startedAt} />}
        </span>
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
