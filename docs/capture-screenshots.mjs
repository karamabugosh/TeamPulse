import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'screenshots');
const baseUrl = process.env.PULSE_URL || 'http://localhost:5175';

fs.mkdirSync(outDir, { recursive: true });

const pages = [
  { route: '/overview', file: '01-overview.png', heading: /Welcome back/i },
  { route: '/checkins', file: '02-checkins.png', heading: 'CheckIns' },
  { route: '/teams', file: '03-teams.png', heading: /Teams/i },
  { route: '/reports', file: '04-reports.png', heading: /Reports/i },
  { route: '/settings', file: '05-settings.png', heading: /Settings/i },
];

async function gotoDashboard(page, route) {
  const url = `${baseUrl}${route}`;
  const workspaces = page
    .waitForResponse(
      (response) => {
        try {
          return new URL(response.url()).pathname.endsWith('/api/admin/workspaces');
        } catch {
          return false;
        }
      },
      { timeout: 30000 },
    )
    .catch((error) => {
      console.warn(`workspaces API was not observed for ${route}:`, error.message);
      return null;
    });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await Promise.race([
    workspaces,
    page.getByRole('heading').first().waitFor({ state: 'visible', timeout: 30000 }),
  ]);
}

const browser = await chromium.launch({
  args:
    process.env.CI === 'true'
      ? ['--no-sandbox', '--disable-setuid-sandbox']
      : [],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
});
const page = await context.newPage();

page.on('pageerror', (error) => {
  console.error('[pageerror]', error.message);
});
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    console.error('[console.error]', msg.text());
  }
});

try {
  for (const item of pages) {
    const url = `${baseUrl}${item.route}`;
    console.log(`Capturing ${url} -> ${item.file}`);
    await gotoDashboard(page, item.route);
    await page
      .getByRole(
        'heading',
        typeof item.heading === 'string'
          ? { name: item.heading, exact: true }
          : { name: item.heading },
      )
      .first()
      .waitFor({
        state: 'visible',
        timeout: 60000,
      });
    await page.screenshot({
      path: path.join(outDir, item.file),
      fullPage: true,
    });
  }

  // CheckIn creation dialog — opener on /checkins is "New CheckIn".
  // "Create CheckIn" is the dialog title / submit label, not the page button.
  console.log(`Opening CheckIn dialog at ${baseUrl}/checkins`);
  await gotoDashboard(page, '/checkins');
  const pageHeading = page.getByRole('heading', { name: 'CheckIns', exact: true });
  await pageHeading.waitFor({ state: 'visible', timeout: 60000 });
  console.log('Dialog capture URL:', page.url());
  console.log('h1 texts:', JSON.stringify(await page.locator('h1').allTextContents()));
  console.log('button labels:', JSON.stringify(await page.locator('button').allTextContents()));

  const openButton = page.getByRole('button', { name: 'New CheckIn', exact: true });
  await openButton.waitFor({ state: 'visible', timeout: 30000 });
  await openButton.click();
  await page.getByRole('heading', { name: 'Create CheckIn', exact: true }).waitFor({
    state: 'visible',
    timeout: 15000,
  });

  await page.screenshot({
    path: path.join(outDir, '06-checkin-create-dialog.png'),
    fullPage: true,
  });
} catch (error) {
  const failurePng = path.join(outDir, '99-playwright-failure.png');
  const failureHtml = path.join(outDir, '99-playwright-failure.html');
  try {
    const labels = await page.locator('button').allTextContents();
    console.error('Button labels at failure:', JSON.stringify(labels));
    fs.writeFileSync(
      path.join(outDir, '99-playwright-debug.txt'),
      [
        `URL: ${page.url()}`,
        `h1: ${JSON.stringify(await page.locator('h1').allTextContents())}`,
        `buttons: ${JSON.stringify(await page.locator('button').allTextContents())}`,
      ].join('\n'),
      'utf8',
    );
    await page.screenshot({ path: failurePng, fullPage: true });
    fs.writeFileSync(failureHtml, await page.content(), 'utf8');
    console.error(`Failure URL: ${page.url()}`);
    console.error(`Saved ${failurePng} and ${failureHtml}`);
  } catch (dumpError) {
    console.error('Could not write failure dump:', dumpError);
  }
  throw error;
} finally {
  await browser.close();
}

console.log('Screenshots saved to', outDir);
