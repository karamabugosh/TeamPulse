/**
 * Post-build SPA fallbacks for static hosts.
 * - 404.html: some CDNs serve this for missing paths (GitHub Pages pattern).
 * - Route folders: serve /overview/index.html when /overview/ is requested.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, '..', 'dist');
const indexHtml = join(dist, 'index.html');

if (!existsSync(indexHtml)) {
  console.error('spa-fallback: dist/index.html missing — run vite build first');
  process.exit(1);
}

copyFileSync(indexHtml, join(dist, '404.html'));
console.log('spa-fallback: wrote dist/404.html');

const routes = [
  'overview',
  'teams',
  'checkins',
  'checkins/standup',
  'checkins/history',
  'settings',
  'jira',
  'reports',
  'blockers',
  'ai-workspace',
  'ai-evaluation',
];

for (const route of routes) {
  const dir = join(dist, route);
  mkdirSync(dir, { recursive: true });
  copyFileSync(indexHtml, join(dir, 'index.html'));
  console.log(`spa-fallback: wrote dist/${route}/index.html`);
}
