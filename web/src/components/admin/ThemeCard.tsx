import { CircleCheck, Zap } from 'lucide-react';
import type { ThemeEntry } from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ThemePreview } from './ThemePreview';
import { paletteFor } from './themePalettes';

interface Props {
  theme: ThemeEntry;
  active: boolean;
  switching: boolean;
  onSwitch: (id: string) => void;
}

export function ThemeCard({ theme, active, switching, onSwitch }: Props) {
  return (
    <div
      className={cn(
        'flex gap-4 rounded-xl border bg-surface p-4',
        active ? 'border-primary' : 'border-line',
      )}
    >
      <ThemePreview palette={paletteFor(theme.id)} />
      <div className="flex min-w-0 flex-1 flex-col gap-[7px] py-0.5">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-ink">{theme.name}</span>
          <span className="text-[11px] text-ink-faint">v{theme.version}</span>
          {active && (
            <Badge>
              <CircleCheck size={11} />
              使用中
            </Badge>
          )}
        </div>
        <div className="text-xs text-ink-faint">{theme.author}</div>
        <p className="text-xs leading-relaxed text-ink-secondary">{theme.description}</p>
        <div className="mt-auto">
          {active ? (
            <Button variant="outline" disabled className="w-full">
              <CircleCheck size={12} />
              当前主题
            </Button>
          ) : (
            <Button disabled={switching} onClick={() => onSwitch(theme.id)} className="w-full">
              <Zap size={12} />
              {switching ? '切换中...' : '启用'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
