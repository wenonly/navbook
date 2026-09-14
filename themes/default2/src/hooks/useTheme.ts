import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

function initial(): ThemeMode {
  if (typeof document !== 'undefined' && document.documentElement.dataset.mode === 'dark') {
    return 'dark'; // index.html 内联脚本已恢复过
  }
  return 'light';
}

export function useTheme(): [ThemeMode, () => void] {
  const [mode, setMode] = useState<ThemeMode>(initial);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    localStorage.setItem('navbook-theme', mode);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode(m => (m === 'dark' ? 'light' : 'dark'));
  }, []);

  return [mode, toggle];
}
