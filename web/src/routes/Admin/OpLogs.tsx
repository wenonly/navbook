import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Bot, User } from 'lucide-react';
import { api } from '@/api/client';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface OpLogEntry {
  id: number;
  action: string;
  source: 'manual' | 'ai' | string;
  conversationId: number | null;
  targetId: number | null;
  summary: string;
  before: unknown;
  after: unknown;
  createdAt: number;
}

const PAGE_SIZE = 30;

function fmtTime(ts: number) {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** action → 中文标签 + 色调 */
function actionMeta(action: string) {
  const [kind, verb] = action.split('.');
  const kindLabel = { link: '链接', category: '分类', site: '站点', memory: '记忆' }[kind] ?? kind;
  const verbLabel = { create: '新增', update: '修改', delete: '删除' }[verb] ?? verb;
  const tone = verb === 'delete' ? 'text-destructive' : verb === 'create' ? 'text-emerald-600' : 'text-amber-600';
  return { label: `${kindLabel}${verbLabel}`, tone };
}

export function AdminOpLogs() {
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const logs = useQuery({
    queryKey: ['op-logs', page],
    queryFn: () => api.opLogs(page, PAGE_SIZE) as Promise<{ count: number; data: OpLogEntry[] }>,
    placeholderData: prev => prev,   // 翻页不闪骨架
  });

  const total = logs.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="操作日志" subtitle="所有数据操作全量留痕(手动后台与 AI 助手),含操作前后快照;AI 撤销即用现有工具按快照改回" />

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="w-8 px-3 py-2.5"></th>
              <th className="w-40 px-3 py-2.5">时间</th>
              <th className="w-24 px-3 py-2.5">操作</th>
              <th className="w-20 px-3 py-2.5">来源</th>
              <th className="px-3 py-2.5">摘要</th>
            </tr>
          </thead>
          <tbody>
            {logs.isLoading &&
              Array.from({ length: 8 }, (_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border/60">
                  <td className="px-3 py-2.5"><Skeleton className="h-3.5 w-3.5" /></td>
                  <td className="px-3 py-2.5"><Skeleton className="h-3.5 w-28" /></td>
                  <td className="px-3 py-2.5"><Skeleton className="h-3.5 w-12" /></td>
                  <td className="px-3 py-2.5"><Skeleton className="h-4 w-12 rounded-full" /></td>
                  <td className="px-3 py-2.5"><Skeleton className={`h-3.5 ${i % 3 === 0 ? 'w-2/3' : 'w-1/2'}`} /></td>
                </tr>
              ))}
            {logs.data?.data.map(l => {
              const meta = actionMeta(l.action);
              const open = openId === l.id;
              return (
                <Fragment key={l.id}>
                  <tr className="border-b border-border/60 hover:bg-muted/40">
                    <td className="px-3 py-2.5">
                      <button className="text-muted-foreground hover:text-foreground"
                        onClick={() => setOpenId(open ? null : l.id)} aria-label={open ? '收起' : '展开详情'}>
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{fmtTime(l.createdAt)}</td>
                    <td className={`px-3 py-2.5 text-xs font-medium ${meta.tone}`}>{meta.label}</td>
                    <td className="px-3 py-2.5">
                      {l.source === 'ai'
                        ? <Badge className="gap-1 bg-primary/10 text-primary hover:bg-primary/10"><Bot size={11} />AI</Badge>
                        : <Badge variant="secondary" className="gap-1"><User size={11} />手动</Badge>}
                    </td>
                    <td className="px-3 py-2.5 text-[13px]">
                      {l.summary}
                      {l.source === 'ai' && l.conversationId != null && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground">(会话 #{l.conversationId})</span>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-border/60 bg-muted/30">
                      <td colSpan={5} className="px-3 py-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="mb-1 text-[11px] font-medium text-muted-foreground">操作前</p>
                            <pre className="max-h-60 overflow-auto rounded-md border border-border bg-background p-2.5 text-[11px] leading-relaxed">
                              {l.before == null ? '(无)' : JSON.stringify(l.before, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <p className="mb-1 text-[11px] font-medium text-muted-foreground">操作后</p>
                            <pre className="max-h-60 overflow-auto rounded-md border border-border bg-background p-2.5 text-[11px] leading-relaxed">
                              {l.after == null ? '(无)' : JSON.stringify(l.after, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {logs.data && !logs.data.data.length && (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                还没有任何操作记录
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>共 {total} 条 · 第 {page}/{totalPages} 页</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  );
}
