/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // 默认刻度缺 4.5/6.5/7.5/8.5/9.5/15/27/100/105，不补则这些工具类静默不生成
      spacing: {
        '4.5': '1.125rem',
        '6.5': '1.625rem',
        '7.5': '1.875rem',
        '8.5': '2.125rem',
        '9.5': '2.375rem',
        15: '3.75rem',
        27: '6.75rem',
      },
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        card: 'var(--card)',
        field: 'var(--field)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        fg: 'var(--fg)',
        muted: 'var(--fg-muted)',
        faint: 'var(--fg-faint)',
        accent: 'var(--accent)',
        'accent-strong': 'var(--accent-strong)',
        'accent-soft': 'var(--accent-soft)',
      },
      borderRadius: {
        card: '12px',
        input: '10px',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        hover: 'var(--shadow-hover)',
        pop: 'var(--shadow-pop)',
      },
    },
  },
  plugins: [],
};
