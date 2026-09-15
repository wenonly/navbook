import { toneBg, toneFg, type ToneName } from '../lib/tone';

interface Props {
  /** FontAwesome 类名（数据里的 font_icon）；为空时回退首字母 */
  icon?: string | null;
  /** 回退字母取自该名称 */
  label: string;
  tone: ToneName;
  size?: 'sm' | 'section' | 'md';
  title?: string;
}

const BOX = {
  sm: 'h-6.5 w-6.5 rounded-md',
  section: 'h-7 w-7 rounded-lg',
  md: 'h-10 w-10 rounded-[10px]',
};
const ICON = { sm: 'text-[13px]', section: 'text-sm', md: 'text-lg' };
const LETTER = { sm: 'text-xs', section: 'text-xs', md: 'text-[15px]' };

/** 彩色 tint 图标方块：有 FA 类名显示图标，否则显示名称首字符 */
export default function IconTile({ icon, label, tone, size = 'md', title }: Props) {
  const letter = label.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      title={title}
      className={`flex shrink-0 select-none items-center justify-center font-semibold ${BOX[size]} ${toneBg(tone)}`}
    >
      {icon ? (
        <i className={`${icon} ${ICON[size]} ${toneFg(tone)}`} aria-hidden />
      ) : (
        <span className={toneFg(tone)}>
          <span className={LETTER[size]}>{letter}</span>
        </span>
      )}
    </span>
  );
}
