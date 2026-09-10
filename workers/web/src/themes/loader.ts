import type { ComponentType } from 'react';
import type { NavData } from '@/types/nav';

const components = import.meta.glob<{ default: ComponentType<{ data: NavData }> }>('./*/index.tsx');
const tokens = import.meta.glob<string>('./*/tokens.css', { query: '?raw', import: 'default' });

export const themeIds = Object.keys(components)
  .map(p => p.replace(/^\.\//, '').replace(/\/index\.tsx$/, ''));

export async function loadTheme(id: string) {
  const compLoader = components[`./${id}/index.tsx`];
  if (!compLoader) throw new Error(`Theme not found: ${id}`);
  const [compMod, tokensStr] = await Promise.all([
    compLoader(),
    tokens[`./${id}/tokens.css`](),
  ]);
  return { Component: compMod.default, tokens: tokensStr };
}

export const displayName = (id: string) =>
  id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
