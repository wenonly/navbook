import { useState } from 'react';
import { useLinks, useCategories, useAddLink, useDelLink } from '@/api/hooks';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Table, Th, Td } from '@/components/ui/Table';
import { ErrorNote, Loading } from '@/components/ui/Feedback';
import { LetterAvatar } from '@/components/admin/LetterAvatar';

interface LinkRow {
  id: number;
  title: string;
  url: string;
  categoryName: string;
}

export function AdminLinks() {
  const { data: catData } = useCategories();
  const { data: linkData, isLoading } = useLinks();
  const add = useAddLink();
  const del = useDelLink();

  const [form, setForm] = useState({ fid: 0, title: '', url: '', description: '' });
  const [error, setError] = useState('');

  if (isLoading) return <Loading />;
  const cats: Array<{ id: number; name: string }> = catData?.data ?? [];
  const links: LinkRow[] = linkData?.data ?? [];

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
      <PageHeader title="链接管理" />

      <form className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5" onSubmit={submit}>
        <Select
          value={form.fid}
          onChange={e => setForm({ ...form, fid: parseInt(e.target.value, 10) })}
        >
          <option value={0}>选择分类</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input
          placeholder="标题"
          value={form.title}
          onChange={e => setForm({ ...form, title: e.target.value })}
        />
        <Input
          placeholder="URL（https://...）"
          value={form.url}
          onChange={e => setForm({ ...form, url: e.target.value })}
        />
        <Input
          placeholder="描述（可选）"
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
        />
        <Button type="submit" disabled={add.isPending}>
          新增链接
        </Button>
      </form>
      {error && <div className="mb-2"><ErrorNote>{error}</ErrorNote></div>}

      <Table>
        <thead>
          <tr>
            <Th className="w-16">ID</Th>
            <Th>标题</Th>
            <Th>URL</Th>
            <Th className="w-32">分类</Th>
            <Th className="w-20">操作</Th>
          </tr>
        </thead>
        <tbody>
          {links.length === 0 && (
            <tr>
              <Td colSpan={5} className="py-10 text-center text-ink-faint">暂无链接,使用上方表单添加</Td>
            </tr>
          )}
          {links.map(l => (
            <tr key={l.id} className="transition-colors hover:bg-row-hover">
              <Td className="text-ink-faint">{l.id}</Td>
              <Td>
                <div className="flex items-center gap-2.5">
                  <LetterAvatar text={l.title} />
                  <span className="font-medium text-ink">{l.title}</span>
                </div>
              </Td>
              <Td className="max-w-xs truncate font-mono text-xs text-ink-secondary">{l.url}</Td>
              <Td className="text-ink-secondary">{l.categoryName}</Td>
              <Td>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger-soft hover:text-danger"
                  onClick={() => {
                    if (confirm(`删除链接「${l.title}」？`)) del.mutate(l.id);
                  }}
                >
                  删除
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
