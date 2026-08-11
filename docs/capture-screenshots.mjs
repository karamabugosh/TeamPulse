import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'screenshots');
const baseUrl = process.env.PULSE_URL || 'http://localhost:5175';

const pages = [
  { route: '/overview', file: '01-overview.png', wait: 3000 },
  { route: '/checkins', file: '02-checkins.png', wait: 2000 },
  { route: '/teams', file: '03-teams.png', wait: 2000 },
  { route: '/reports', file: '04-reports.png', wait: 2000 },
  { route: '/settings', file: '05-settings.png', wait: 2000 },
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
});
const page = await context.newPage();

for (const item of pages) {
  const url = `${baseUrl}${item.route}`;
  console.log(`Capturing ${url} -> ${item.file}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(item.wait);
  await page.screenshot({
    path: path.join(outDir, item.file),
    fullPage: true,
  });
}

// CheckIn creation dialog
await page.goto(`${baseUrl}/checkins`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Create CheckIn/i }).click();
await page.waitForTimeout(1500);
await page.screenshot({
  path: path.join(outDir, '06-checkin-create-dialog.png'),
  fullPage: true,
});

await browser.close();
console.log('Screenshots saved to', outDir);
