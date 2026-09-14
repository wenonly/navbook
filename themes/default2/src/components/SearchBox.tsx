import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchItem } from '../lib/search';
import { search } from '../lib/search';
import { toneOf, toneBg, toneFg } from '../lib/tone';
import { IconEnter, IconSearch } from './Icons';

interface Props {
  index: SearchItem[];
  className?: string;
}

/** 搜索框 + 结果下拉：⌘K 聚焦、↑↓ 选择、Enter 直达、Esc 关闭 */
export default function SearchBox({ index, className = '' }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => search(index, query), [index, query]);

  useEffect(() => setHi(0), [query]);

  // ⌘K / Ctrl+K 聚焦；通过 offsetParent 判断本实例是否可见（桌面/移动只居其一）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (inputRef.current?.offsetParent !== null) inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const open = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length) setHi(i => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length) setHi(i => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      const hit = results[hi];
      if (hit) open(hit.link.url);
    } else if (e.key === 'Escape') {
      setQuery('');
      inputRef.current?.blur();
    }
  };

  const showDropdown = focused && query.trim().length > 0;

  return (
    <div className={`relative ${className}`}>
      <div
        className={`flex h-9.5 items-center gap-2 rounded-input bg-field px-3 transition
          ${focused ? 'border border-accent bg-surface shadow-hover' : 'border border-transparent'}`}
      >
        <span className={focused ? 'text-accent' : 'text-faint'}>
          <IconSearch size={15} />
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          placeholder={`搜索分类或链接，共 ${index.length} 个…`}
          aria-label="搜索分类或链接"
          className="w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-faint"
        />
        {!focused && !query && (
          <kbd className="hidden shrink-0 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted sm:block">
            ⌘K
          </kbd>
        )}
      </div>

      {showDropdown && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-card border border-border bg-surface p-1.5 shadow-pop">
          {results.length === 0 ? (
            <p className="px-2.5 py-4 text-center text-xs text-faint">
              没有找到与「{query.trim()}」相关的链接
            </p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.link.id}
                type="button"
                onMouseEnter={() => setHi(i)}
                onClick={() => open(r.link.url)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${
                  i === hi ? 'bg-accent-soft' : ''
                }`}
              >
                <HitTile icon={r.link.font_icon} label={r.link.title} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-fg">{r.link.title}</span>
                  <span className="block truncate text-[11px] text-faint">
                    {r.link.description || r.catPath}
                  </span>
                </span>
                {i === hi && (
                  <span className="shrink-0 text-accent">
                    <IconEnter size={13} />
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function HitTile({ icon, label }: { icon: string | null; label: string }) {
  const tone = toneOf(label);
  const letter = label.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className={`flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold ${toneBg(tone)}`}
    >
      {icon ? (
        <i className={`${icon} text-[13px] ${toneFg(tone)}`} aria-hidden />
      ) : (
        <span className={toneFg(tone)}>{letter}</span>
      )}
    </span>
  );
}
