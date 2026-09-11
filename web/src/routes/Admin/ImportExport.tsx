import { useRef, useState } from 'react';
import { api } from '@/api/client';

interface ImportStats {
  categories_created: number;
  categories_reused: number;
  links_imported: number;
  links_skipped: number;
}

export function AdminImportExport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [pendingFile, setPendingFile] = useState<{ name: string; data: unknown } | null>(null);

  async function doExport() {
    setError('');
    setStats(null);
    try {
      const res = await api.exportJson();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `onenav-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError('');
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
      const ok = confirm(
        `文件「${file.name}」：${cats.length} 个分类 / ${linkCount} 条链接。\n` +
        '同名分类将合并，重复 URL 将跳过。确认导入？' +
        '\n注意：导入后的条目将对访客公开。'
      );
      if (!ok) {
        if (fileRef.current) fileRef.current.value = '';
        return;
      }
      setPendingFile({ name: file.name, data });
    }).catch(err => {
      setError(err instanceof Error ? err.message : '读取文件失败');
      if (fileRef.current) fileRef.current.value = '';
    });
  }

  async function doImport() {
    if (!pendingFile) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.importJson(pendingFile.data);
      setStats(res.data);
      setPendingFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-bold mb-6" style={{ color: 'var(--color-text)' }}>导入 / 导出</h2>

      <section className="mb-8 p-4 border rounded" style={{ borderColor: 'var(--color-border)' }}>
        <h3 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>导出备份</h3>
        <p className="text-sm mb-3" style={{ color: 'var(--color-text-subtle)' }}>
          导出全部公开分类与链接（PHP OneNav / ZMark 兼容格式）。
        </p>
        <button
          type="button"
          onClick={doExport}
          className="px-4 py-2 rounded text-sm text-white"
          style={{ background: 'var(--color-primary)' }}
        >
          下载 JSON
        </button>
      </section>

      <section className="p-4 border rounded" style={{ borderColor: 'var(--color-border)' }}>
        <h3 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>导入书签</h3>
        <p className="text-sm mb-3" style={{ color: 'var(--color-text-subtle)' }}>
          支持从 PHP 版 OneNav 后台导出的 JSON（type: onenav.bookmarks）。同名分类合并，重复 URL 自动跳过。
          注意：导出格式不含私密标记，文件中所有分类与链接导入后都将公开可见。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          onChange={onFile}
          className="block w-full text-sm mb-3"
        />
        {pendingFile && (
          <button
            type="button"
            disabled={busy}
            onClick={doImport}
            className="px-4 py-2 rounded text-sm text-white disabled:opacity-50"
            style={{ background: 'var(--color-primary)' }}
          >
            {busy ? '导入中...' : `确认导入 ${pendingFile.name}`}
          </button>
        )}
        {stats && (
          <div className="mt-4 p-3 rounded text-sm" style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text)' }}>
            导入完成：新建分类 {stats.categories_created}、复用分类 {stats.categories_reused}、
            导入链接 {stats.links_imported}、跳过 {stats.links_skipped}。
          </div>
        )}
      </section>

      {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
    </div>
  );
}
