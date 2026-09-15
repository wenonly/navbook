import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../src/db/client';
import { getActiveTheme, setActiveTheme, mergeManifest } from '../src/handlers/themes';
import { resetTables } from './helpers';

beforeEach(async () => {
  await resetTables();
});

const db = () => getDb(env.DB);

describe('主题配置', () => {
  it('active 缺省为 compass', async () => {
    expect(await getActiveTheme(db())).toBe('compass');
  });

  it('set 后生效且可覆盖', async () => {
    await setActiveTheme(db(), 'minima');
    expect(await getActiveTheme(db())).toBe('minima');
    await setActiveTheme(db(), 'compass');
    expect(await getActiveTheme(db())).toBe('compass');
  });

  it('manifest 合并：D1 覆盖段优先，按 id 去重', async () => {
    const assetsManifest = [
      { id: 'compass', name: 'Compass', version: '1', author: 'a', description: '', minAppVersion: '1' },
    ];
    const d1Manifest = [
      { id: 'uploaded-theme', name: 'U', version: '2', author: 'b', description: '', minAppVersion: '1' },
      { id: 'compass', name: 'D1 覆盖版', version: '9', author: 'b', description: '', minAppVersion: '1' },
    ];
    const merged = mergeManifest(d1Manifest, assetsManifest);
    expect(merged.map(t => t.id).sort()).toEqual(['compass', 'uploaded-theme']);
    expect(merged.find(t => t.id === 'compass')!.name).toBe('D1 覆盖版');
  });
});
