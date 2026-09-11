#!/usr/bin/env node
/**
 * 聚合构建产物到 workers/dist/：
 *   web/dist            → workers/dist/admin/
 *   themes/<id>/dist    → workers/dist/themes/<id>/
 *   public/*            → workers/dist/（根级）
 *   扫描 themes/<id>/dist/theme.json → workers/dist/themes/manifest.json
 * 末尾自检关键产物，缺失即非零退出（防半产物部署）。
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'workers', 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// web → admin/
cpSync(join(root, 'web', 'dist'), join(out, 'admin'), { recursive: true });

// 根公共资产
cpSync(join(root, 'public'), out, { recursive: true });

// themes → themes/<id>/ + manifest
const themesDir = join(root, 'themes');
const manifest = [];
for (const entry of readdirSync(themesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dist = join(themesDir, entry.name, 'dist');
  const themeJson = join(dist, 'theme.json');
  if (!existsSync(themeJson)) {
    console.warn(`⚠ themes/${entry.name} 无 dist/theme.json，跳过（先构建）`);
    continue;
  }
  cpSync(dist, join(out, 'themes', entry.name), { recursive: true });
  manifest.push(JSON.parse(readFileSync(themeJson, 'utf8')));
}
writeFileSync(join(out, 'themes', 'manifest.json'), JSON.stringify(manifest, null, 2));

// 自检
const checks = [
  join(out, 'admin', 'index.html'),
  join(out, 'themes', 'manifest.json'),
  join(out, 'favicon.svg'),
];
for (const t of manifest) checks.push(join(out, 'themes', t.id, 'index.html'));
const missing = checks.filter(p => !existsSync(p));
if (missing.length) {
  console.error(`✘ 聚合自检失败，缺：${missing.join(', ')}`);
  process.exit(1);
}
console.log(`✓ 聚合完成：admin + ${manifest.length} 主题（${manifest.map(t => t.id).join(', ')}）→ workers/dist`);
