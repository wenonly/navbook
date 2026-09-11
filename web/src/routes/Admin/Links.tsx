import { useState } from 'react';
import { useLinks, useCategories, useAddLink, useDelLink } from '@/api/hooks';

export function AdminLinks() {
  const { data: catData } = useCategories();
  const { data: linkData, isLoading } = useLinks();
  const add = useAddLink();
  const del = useDelLink();

  const [form, setForm] = useState({ fid: 0, title: '', url: '', description: '' });
  const [error, setError] = useState('');

  if (isLoading) return <div>加载中...</div>;
  const cats: any[] = catData?.data ?? [];
  const links: any[] = linkData?.data ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.fid || !form.title.trim() || !form.url.trim()) {
      setError('分类、标题、URL 均为必填');
      return;
    }
    try {
      await add.mutateAsync({
        ...form,
        weight: 0, property: 0, url_standby: '', font_icon: '',
      });
      setForm({ fid: 0, title: '', url: '', description: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--color-text)' }}>链接管理</h2>
      <form className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-2" onSubmit={submit}>
        <select
          value={form.fid}
          onChange={e => setForm({ ...form, fid: parseInt(e.target.value, 10) })}
          className="px-2 py-1 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <option value={0}>选择分类</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input
          placeholder="标题"
          value={form.title}
          onChange={e => setForm({ ...form, title: e.target.value })}
          className="px-3 py-1 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <input
          placeholder="URL（https://...）"
          value={form.url}
          onChange={e => setForm({ ...form, url: e.target.value })}
          className="px-3 py-1 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <input
          placeholder="描述（可选）"
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
          className="px-3 py-1 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <button
          type="submit"
          disabled={add.isPending}
          className="px-4 py-1 rounded text-white disabled:opacity-50"
          style={{ background: 'var(--color-primary)' }}
        >
          新增链接
        </button>
      </form>
      {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
            <th className="text-left py-2">ID</th>
            <th className="text-left py-2">标题</th>
            <th className="text-left py-2">URL</th>
            <th className="text-left py-2">分类</th>
            <th className="text-left py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {links.map(l => (
            <tr key={l.id} className="border-b" style={{ borderColor: 'var(--color-border)' }}>
              <td className="py-2">{l.id}</td>
              <td className="py-2">{l.title}</td>
              <td className="py-2 text-xs truncate max-w-xs">{l.url}</td>
              <td className="py-2">{l.categoryName}</td>
              <td className="py-2">
                <button
                  className="text-red-500"
                  onClick={() => {
                    if (confirm(`删除链接「${l.title}」？`)) del.mutate(l.id);
                  }}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
