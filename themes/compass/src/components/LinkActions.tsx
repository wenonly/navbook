// 链接右键菜单 + 编辑弹窗(仅登录管理员)。
// 菜单:复制链接 / 编辑(含移动分类)/ 私有·公开切换 / 删除(二步确认)。
// 修改走 shared client 的 edit_link/del_link;编辑前先 get_a_link 取权威全字段
// (weight/url_standby/font_icon 等主题侧 NavLink 没有的列,避免被默认值抹掉)。
import { useEffect, useRef, useState } from 'react';
import { createApiClient } from '@navbook/shared';
import type { NavCategory, NavLink } from '@navbook/shared';

const api = createApiClient({ onUnauthorized: false });

export interface LinkMenuState { link: NavLink; x: number; y: number }

interface FullLink {
  id: number; fid: number; title: string; url: string;
  description: string | null; weight: number; property: number;
  urlStandby: string | null; fontIcon: string | null;
}

/** 拉权威全字段;失败回退到主题侧 NavLink 已有字段(weight 兜底 0) */
async function fetchFull(link: NavLink): Promise<FullLink> {
  try {
    const res = await api.getLink(link.id) as { code: number; data: FullLink | null };
    if (res.code === 0 && res.data) return res.data;
  } catch { /* 网络问题走回退 */ }
  return {
    id: link.id, fid: link.fid, title: link.title, url: link.url,
    description: link.description, weight: 0, property: link.private ? 1 : 0,
    urlStandby: link.url_standby, fontIcon: link.font_icon,
  };
}

function itemClasses(extra = '') {
  return `flex w-full items-center gap-2.5 rounded-input px-3 py-2 text-left text-[13px] text-fg
          transition-colors hover:bg-accent-soft hover:text-fg ${extra}`;
}

export default function LinkActions({
  state, categories, onClose, onChanged,
}: {
  state: LinkMenuState;
  categories: NavCategory[];
  onClose: () => void;
  onChanged: () => void;   // 任何写操作后静默刷新数据
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 视口边缘自适应 + 点击外部/Escape/滚轮关闭(编辑弹窗态不挂——弹窗有自己的遮罩关闭,
  // 且此时 menuRef 已空,任何 mousedown 都会误关弹窗)
  useEffect(() => {
    if (editing) return;
    const el = menuRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      el.style.left = `${Math.min(state.x, window.innerWidth - r.width - 8)}px`;
      el.style.top = `${Math.min(state.y, window.innerHeight - r.height - 8)}px`;
    }
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [state.x, state.y, onClose, editing]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(state.link.url); } catch { /* 剪贴板被拒 */ }
    setCopied(true);
    setTimeout(onClose, 650);
  };

  const togglePrivate = async () => {
    setBusy(true);
    const full = await fetchFull(state.link);
    try {
      await api.editLink({
        id: full.id, fid: full.fid, title: full.title, url: full.url,
        description: full.description ?? '', weight: full.weight,
        property: full.property === 1 ? 0 : 1,
        url_standby: full.urlStandby ?? '', font_icon: full.fontIcon ?? '',
      });
      onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作失败');
      setBusy(false);
      return;
    }
  };

  const doDelete = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    setBusy(true);
    try {
      await api.delLink(state.link.id);
      onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败');
      setBusy(false);
    }
  };

  if (editing) {
    return <EditDialog
      link={state.link}
      categories={categories}
      onCancel={onClose}
      onSaved={() => { onChanged(); onClose(); }}
    />;
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[60] w-48 rounded-card border border-border bg-card p-1 shadow-pop"
      style={{ left: state.x, top: state.y }}
      onContextMenu={e => e.preventDefault()}
    >
      <button className={itemClasses()} onClick={copy}>
        <Ico d="M8 3h8M4 8h16M6 8l1.2 11a2 2 0 002 1.8h5.6a2 2 0 002-1.8L18 8M9 12v4M15 12v4" danger={false} />
        {copied ? <span className="text-emerald-600">已复制 ✓</span> : '复制链接'}
      </button>
      <button className={itemClasses()} onClick={() => setEditing(true)}>
        <Ico d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17v3zM13.5 6.5l3 3" />
        编辑 / 移动
      </button>
      <button className={itemClasses()} disabled={busy} onClick={togglePrivate}>
        <Ico d={state.link.private
          ? 'M12 3a4.5 4.5 0 00-2.5 8.2V14h5v-2.8A4.5 4.5 0 0012 3zM9.5 17h5M10.5 20h3'
          : 'M6 11a6 6 0 0112 0v3l1.5 3h-15L6 14v-3zM10 20a2.4 2.4 0 004 0'} />
        {state.link.private ? '设为公开' : '设为私有'}
      </button>
      <div className="mx-2 my-1 border-t border-border" />
      <button
        className={itemClasses(confirmDel
          ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/60'
          : 'text-red-600 dark:text-red-400')}
        disabled={busy}
        onClick={doDelete}
      >
        <Ico danger d="M5 7h14M9 7V5a1.5 1.5 0 011.5-1.5h3A1.5 1.5 0 0115 5v2m3 0l-.8 12a2 2 0 01-2 1.8H8.8a2 2 0 01-2-1.8L6 7M10 11v6M14 11v6" />
        {confirmDel ? '再点一次确认删除' : '删除'}
      </button>
      {err && <div className="px-3 py-1.5 text-[11px] text-red-500">{err}</div>}
    </div>
  );
}

/** 行内 16px 线性小图标(风挶 compass 手写 Icons,不引 lucide) */
function Ico({ d, danger }: { d: string; danger?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      className={danger ? 'shrink-0' : 'shrink-0 text-muted'}>
      <path d={d} />
    </svg>
  );
}

/** 编辑弹窗:标题/URL/分类(两级)/描述/私密;保存走 edit_link 全字段 */
function EditDialog({ link, categories, onCancel, onSaved }: {
  link: NavLink;
  categories: NavCategory[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: link.title, url: link.url, fid: link.fid,
    description: link.description ?? '', property: link.private ? 1 : 0,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!form.title.trim() || !form.url.trim()) { setErr('标题与 URL 不能为空'); return; }
    setSaving(true);
    const full = await fetchFull(link);
    try {
      await api.editLink({
        id: link.id, fid: form.fid, title: form.title.trim(), url: form.url.trim(),
        description: form.description, weight: full.weight, property: form.property,
        url_standby: full.urlStandby ?? '', font_icon: full.fontIcon ?? '',
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
      setSaving(false);
    }
  };

  const field = 'h-9 w-full rounded-input border border-border bg-field px-3 text-sm text-fg outline-none transition focus:border-accent';
  const label = 'mb-1.5 block text-xs text-muted';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-md rounded-card border border-border bg-card p-5 shadow-pop">
        <div className="mb-4 text-[15px] font-semibold text-fg">编辑链接</div>
        <div className="space-y-3.5">
          <div>
            <label className={label}>标题</label>
            <input className={field} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className={label}>URL</label>
            <input className={field} value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
          </div>
          <div>
            <label className={label}>分类(移动到)</label>
            <select
              className={`${field} appearance-none`}
              value={form.fid}
              onChange={e => setForm(f => ({ ...f, fid: Number(e.target.value) }))}
            >
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}{cat.private ? '(私密)' : ''}</option>
              ))}
              {categories.flatMap(cat => cat.children.map(sub => (
                <option key={sub.id} value={sub.id}>{cat.name} / {sub.name}{sub.private ? '(私密)' : ''}</option>
              )))}
            </select>
          </div>
          <div>
            <label className={label}>描述</label>
            <input className={field} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={form.property === 1}
              onChange={e => setForm(f => ({ ...f, property: e.target.checked ? 1 : 0 }))}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            私密(仅登录后可见)
          </label>
        </div>
        {err && <div className="mt-3 text-xs text-red-500">{err}</div>}
        <div className="mt-5 flex justify-end gap-2.5">
          <button className="h-9 rounded-input border border-border px-4 text-[13px] text-fg transition hover:bg-field" onClick={onCancel}>
            取消
          </button>
          <button
            className="h-9 rounded-input bg-accent px-5 text-[13px] font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
            disabled={saving}
            onClick={save}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
