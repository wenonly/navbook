import { cx } from '@/components/legacy/cx';

const COLORS = [
  'bg-primary-soft text-primary',
  'bg-danger-soft text-danger',
  'bg-success-soft text-success',
  'bg-[#FEF3C7] text-[#B45309]',
  'bg-[#E0F2FE] text-[#0369A1]',
];

function hashIndex(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % COLORS.length;
}

export function LetterAvatar({ text, size = 'md' }: { text: string; size?: 'md' | 'sm' }) {
  const letter = (text.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-semibold',
        size === 'md' ? 'h-8 w-8 text-sm' : 'h-6 w-6 text-xs',
        COLORS[hashIndex(text || '?')],
      )}
    >
      {letter}
    </span>
  );
}
