/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--color-page)',
        surface: 'var(--color-surface)',
        line: 'var(--color-line)',
        'row-hover': 'var(--color-row-hover)',
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          soft: 'var(--color-primary-soft)',
        },
        ink: {
          DEFAULT: 'var(--color-ink)',
          secondary: 'var(--color-ink-secondary)',
          faint: 'var(--color-ink-faint)',
        },
        sidebar: {
          DEFAULT: 'var(--color-sidebar)',
          hover: 'var(--color-sidebar-hover)',
          muted: 'var(--color-sidebar-muted)',
          divider: 'var(--color-sidebar-divider)',
        },
        danger: {
          DEFAULT: 'var(--color-danger)',
          soft: 'var(--color-danger-soft)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          soft: 'var(--color-success-soft)',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
