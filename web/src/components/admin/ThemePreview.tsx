import type { PreviewPalette } from './themePalettes';

// 主题卡片左侧的浏览器缩略图 mockup：窗口圆点 + 地址栏 + 侧栏/内容区示意。
// 纯装饰，尺寸固定（w-[270px] h-[168px]），按设计稿 16:10 比例。
export function ThemePreview({ palette }: { palette: PreviewPalette }) {
  return (
    <div
      className="flex h-[168px] w-[270px] shrink-0 flex-col overflow-hidden rounded-lg"
      style={{ backgroundColor: palette.bg }}
    >
      <div
        className="flex h-[22px] shrink-0 items-center gap-1 px-1.5"
        style={{ backgroundColor: palette.header }}
      >
        <span className="h-[5px] w-[5px] rounded-full bg-[#FF5F57]" />
        <span className="h-[5px] w-[5px] rounded-full bg-[#FEBC2E]" />
        <span className="h-[5px] w-[5px] rounded-full bg-[#28C840]" />
        <div className="ml-1 h-2.5 flex-1 rounded-full" style={{ backgroundColor: palette.pill }} />
      </div>
      <div className="flex flex-1 gap-[5px] p-[7px]">
        <div
          className="flex w-11 shrink-0 flex-col gap-1.5 rounded p-[5px]"
          style={{ backgroundColor: palette.side }}
        >
          <div className="h-3 w-3 rounded-[3px]" style={{ backgroundColor: palette.accent }} />
          <div className="h-1 w-full rounded-sm" style={{ backgroundColor: palette.sideItem }} />
          <div className="h-1 w-full rounded-sm" style={{ backgroundColor: palette.sideItem }} />
          <div className="h-1 w-full rounded-sm" style={{ backgroundColor: palette.sideItem }} />
        </div>
        <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-[5px]">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className="flex flex-col gap-1 rounded p-1.5"
              style={{ backgroundColor: palette.card }}
            >
              <div className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: palette.accent }} />
              <div className="h-1 w-full rounded-sm" style={{ backgroundColor: palette.bar }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
