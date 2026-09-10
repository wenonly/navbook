import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'tinyglobby';

const files = globSync('src/themes/*/tokens.css');
if (files.length === 0) throw new Error('No theme tokens found under src/themes/*/');

const merged = files
  .map(f => `/* ${f} */\n${readFileSync(f, 'utf8').trim()}`)
  .join('\n\n');

const html = readFileSync('index.html', 'utf8');
const placeholder = /<style id="theme-tokens">[\s\S]*?<\/style>/;
if (!placeholder.test(html)) throw new Error('index.html missing <style id="theme-tokens"> placeholder');
const next = html.replace(placeholder, () => `<style id="theme-tokens">\n${merged}\n</style>`);
if (next !== html) {
  writeFileSync('index.html', next);
  console.log(`Inlined ${files.length} theme token files: ${files.join(', ')}`);
} else {
  console.log(`Theme tokens already up to date (${files.length} files): ${files.join(', ')}`);
}
