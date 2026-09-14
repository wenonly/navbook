import { useRef, useState } from 'react';
import { Download, FileJson } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';

interface ImportStats {
  categories_created: number;
  categories_reused: number;
  links_imported: number;
  links_skipped: number;
}

export function AdminImportExport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [pendingFile, setPendingFile] = useState<{ name: string; data: unknown; catCount: number; linkCount: number } | null>(null);

  async function doExport() {
    try {
      const res = await api.exportJson();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `onenav-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setStats(null);
    setPendingFile(null);
    const file = e.target.files?.[0];
    if (!file) return;
    void file.text().then(text => {
      const data = JSON.parse(text);
      const cats = Array.isArray((data as any)?.categories) ? (data as any).categories : [];
      const linkCount = cats.reduce(
        (n: number, c: any) => n + (c.links?.length ?? 0) + (c.children ?? []).reduce(
          (m: number, s: any) => m + (s.links?.length ?? 0), 0), 0);
      if (!cats.length) throw new Error('文件中没有分类数据（type 应为 onenav.bookmarks）');
      // 解析成功即挂起等确认（原生 confirm 改为 ConfirmDialog，统计随 description 展示）
      setPendingFile({ name: file.name, data, catCount: cats.length, linkCount });
    }).catch(err => {
      toast.error(err instanceof Error ? err.message : '读取文件失败');
      if (fileRef.current) fileRef.current.value = '';
    });
  }

  async function doImport() {
    if (!pendingFile) return;
    try {
      const res = await api.importJson(pendingFile.data);
      setStats(res.data);
      setPendingFile(null);
      if (fileRef.current) fileRef.current.value = '';
      toast.success(`导入完成：新建 ${res.data.categories_created} 分类 / 导入 ${res.data.links_imported} 链接`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败');
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="导入 / 导出" />

      <Card className="mb-8 p-5">
        <div className="mb-2 flex items-center gap-2">
          <Download size={16} className="text-primary" />
          <h3 className="font-medium text-ink">导出备份</h3>
        </div>
        <p className="mb-4 text-sm text-ink-secondary">
          导出全部公开分类与链接（PHP OneNav / ZMark 兼容格式）。
        </p>
        <Button onClick={doExport}>
          <Download size={13} />
          下载 JSON
        </Button>
      </Card>

      <Card className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <FileJson size={16} className="text-primary" />
          <h3 className="font-medium text-ink">导入书签</h3>
        </div>
        <p className="mb-4 text-sm text-ink-secondary">
          支持从 PHP 版 OneNav 后台导出的 JSON（type: onenav.bookmarks）。同名分类合并，重复 URL 自动跳过。
          注意：导出格式不含私密标记，文件中所有分类与链接导入后都将公开可见。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          onChange={onFile}
          className="mb-3 block w-full text-sm text-ink-secondary
            file:mr-3 file:h-8 file:cursor-pointer file:rounded-lg file:border-0
            file:bg-primary-soft file:px-3 file:text-sm file:font-medium file:text-primary"
        />
        {stats && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="success">新建分类 {stats.categories_created}</Badge>
            <Badge>复用分类 {stats.categories_reused}</Badge>
            <Badge variant="success">导入链接 {stats.links_imported}</Badge>
            <Badge variant="secondary">跳过 {stats.links_skipped}</Badge>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={pendingFile !== null}
        onOpenChange={v => { if (!v) setPendingFile(null); }}
        title="确认导入？"
        description={`文件「${pendingFile?.name ?? ''}」：${pendingFile?.catCount ?? 0} 个分类 / ${pendingFile?.linkCount ?? 0} 条链接。\n同名分类将合并，重复 URL 将跳过。\n注意：导入后的条目将对访客公开。`}
        confirmText="导入"
        onConfirm={() => { void doImport(); }}
      />
    </div>
  );
}
