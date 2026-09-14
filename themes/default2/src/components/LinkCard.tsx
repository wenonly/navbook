import type { NavLink } from '@navbook/shared';
import type { ToneName } from '../lib/tone';
import { toneOf } from '../lib/tone';
import IconTile from './IconTile';
import { IconLock } from './Icons';

interface Props {
  link: NavLink;
  /** 由分类区块按序轮换指定，保持相邻卡片错色 */
  tone?: ToneName;
}

export default function LinkCard({ link, tone = toneOf(link.title) }: Props) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={link.description ? `${link.title} · ${link.description}` : link.title}
      className={`group flex items-center gap-3 rounded-card border border-border bg-card p-3 shadow-card transition
        hover:border-accent hover:shadow-hover ${link.private ? 'opacity-80' : ''}`}
    >
      <IconTile icon={link.font_icon} label={link.title} tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-1.5">
          <span className="truncate text-sm font-medium text-fg">{link.title}</span>
          {link.private && (
            <span className="shrink-0 text-faint" title="私有（仅登录后可见）">
              <IconLock size={11} />
            </span>
          )}
        </span>
        {link.description && (
          <span className="mt-0.5 block truncate text-xs text-muted">{link.description}</span>
        )}
      </span>
    </a>
  );
}
