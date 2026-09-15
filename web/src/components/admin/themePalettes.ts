// 主题预览缩略图的配色：按主题 id 匹配，未知主题走默认浅色盘。
// 只影响后台卡片里的 mockup，不影响前台主题本身。
export interface PreviewPalette {
  bg: string;
  header: string;
  pill: string;
  side: string;
  sideItem: string;
  card: string;
  bar: string;
  accent: string;
}

const PALETTES: Record<string, PreviewPalette> = {
  compass: {
    bg: '#F4F5F8', header: '#FFFFFF', pill: '#E2E5EC',
    side: '#FFFFFF', sideItem: '#E2E5EC', card: '#FFFFFF', bar: '#E2E5EC', accent: '#4F46E5',
  },
  minima: {
    bg: '#FAFAFA', header: '#FFFFFF', pill: '#E4E4E7',
    side: '#FFFFFF', sideItem: '#E4E4E7', card: '#FFFFFF', bar: '#E4E4E7', accent: '#18181B',
  },
  webstack: {
    bg: '#1E293B', header: '#334155', pill: '#475569',
    side: '#16202F', sideItem: '#475569', card: '#334155', bar: '#64748B', accent: '#F59E0B',
  },
  night: {
    bg: '#0F1420', header: '#1A2130', pill: '#2A3247',
    side: '#131A28', sideItem: '#2A3247', card: '#1A2130', bar: '#2A3247', accent: '#34D399',
  },
};

const FALLBACK = PALETTES.compass;

export function paletteFor(themeId: string): PreviewPalette {
  return PALETTES[themeId] ?? FALLBACK;
}
