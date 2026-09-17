// Gazette 的 AI 助手入口:统一组件 + 公报主题注入。
// 墨色印章圆钮(衬线 N)/纸感面板/零圆角直角(与主题排印一致)。
import { AssistantBubble as SharedAssistant } from '@navbook/shared/assistant';
import type { AssistantTheme } from '@navbook/shared/assistant';
import type { SessionInfo } from '@navbook/shared';

const gazetteTheme: AssistantTheme = {
  bg: 'var(--paper)',
  fg: 'var(--ink)',
  muted: 'var(--ink-soft)',
  faint: 'var(--ink-soft)',
  border: 'var(--ink)',
  field: 'var(--paper)',
  accent: 'var(--ink)',
  accentStrong: 'var(--seal)',
  accentFg: 'var(--paper)',
  font: 'var(--font-serif)',
  radius: 0,
  radiusBtn: 0,
  shadow: 'none',
  bubbleSize: 52,
};

const sealIcon = (
  <span style={{
    fontFamily: 'var(--font-serif)', fontSize: '1.35rem', fontWeight: 700,
    letterSpacing: '.05em', transform: 'rotate(-8deg)', display: 'inline-block',
  }}>N</span>
);

export default function AssistantBubble({ session }: { session: SessionInfo | null }) {
  return (
    <SharedAssistant
      session={session}
      theme={gazetteTheme}
      icon={sealIcon}
      storageKey="gazette-ai-cid"
    />
  );
}
