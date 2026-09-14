// 图标方块调色板：6 组 tint 配对（对应 design.pen 的 tone-* 变量）。
// 按名字哈希稳定取色，同一链接刷新后颜色不变，相邻卡片自然错开。
export type ToneName = 'blue' | 'green' | 'violet' | 'orange' | 'cyan' | 'pink';

const TONES: ToneName[] = ['blue', 'green', 'violet', 'orange', 'cyan', 'pink'];

export function toneOf(key: string): ToneName {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return TONES[Math.abs(h) % TONES.length];
}

/**
 * 按序轮换取色（offset 用分类 id 错开起点）：
 * 相邻卡片颜色必然不同，还原设计稿的错色节奏；比随机哈希更有秩序。
 */
export function toneAt(index: number, offset = 0): ToneName {
  return TONES[Math.abs(index + offset) % TONES.length];
}

// Tailwind 无法安全拼接类名，这里显式映射保证可被 JIT 扫描到。
const BG: Record<ToneName, string> = {
  blue: 'bg-[var(--tone-blue-bg)]',
  green: 'bg-[var(--tone-green-bg)]',
  violet: 'bg-[var(--tone-violet-bg)]',
  orange: 'bg-[var(--tone-orange-bg)]',
  cyan: 'bg-[var(--tone-cyan-bg)]',
  pink: 'bg-[var(--tone-pink-bg)]',
};
const FG: Record<ToneName, string> = {
  blue: 'text-[var(--tone-blue-fg)]',
  green: 'text-[var(--tone-green-fg)]',
  violet: 'text-[var(--tone-violet-fg)]',
  orange: 'text-[var(--tone-orange-fg)]',
  cyan: 'text-[var(--tone-cyan-fg)]',
  pink: 'text-[var(--tone-pink-fg)]',
};

export const toneBg = (t: ToneName) => BG[t];
export const toneFg = (t: ToneName) => FG[t];
