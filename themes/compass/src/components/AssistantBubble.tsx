// compass 的 AI 气泡:统一组件(@navbook/shared/assistant)+ compass 主题注入。
// 颜色经 var(--x) 透传给组件内部 CSS 变量 —— 跟随 compass 明暗主题实时切换。
import { AssistantBubble as SharedAssistant } from '@navbook/shared/assistant';
import type { AssistantTheme } from '@navbook/shared/assistant';
import type { SessionInfo } from '@navbook/shared';

const compassTheme: AssistantTheme = {
  bg: 'var(--card)',
  fg: 'var(--fg)',
  muted: 'var(--muted)',
  faint: 'var(--faint)',
  border: 'var(--border)',
  field: 'var(--field)',
  accent: 'var(--accent)',
  accentStrong: 'var(--accent-strong)',
  radius: 12,
  radiusBtn: 10,
  shadow: 'var(--shadow-pop)',
};

const robotIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2a7 7 0 0 1 7 7v3l2 3-4 1a7 7 0 0 1-10 0l-4-1 2-3V9a7 7 0 0 1 7-7z" />
    <circle cx="9.5" cy="10" r="1" fill="currentColor" /><circle cx="14.5" cy="10" r="1" fill="currentColor" />
  </svg>
);

export default function AssistantBubble({ session }: { session: SessionInfo | null }) {
  return (
    <SharedAssistant
      session={session}
      theme={compassTheme}
      icon={robotIcon}
      storageKey="compass-ai-cid"
    />
  );
}
