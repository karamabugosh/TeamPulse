import { expect, test } from '@playwright/test';

test.describe('Pulse dashboard smoke', () => {
  test('home redirects to the overview dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByText('Pulse').first()).toBeVisible();
  });

  test('overview dashboard loads live metrics chrome', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByText('Live Sync Active')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
  });

  test('there is no login gate before the dashboard', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: /sign in|log in/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('sidebar navigation reaches Check-ins, Teams, Reports, and Settings', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    await page.getByRole('link', { name: 'Check-ins' }).click();
    await expect(page).toHaveURL(/\/checkins$/);
    await expect(page.getByRole('heading', { name: 'CheckIns', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New CheckIn' }).first()).toBeVisible();

    await page.getByRole('link', { name: 'Teams' }).click();
    await expect(page).toHaveURL(/\/teams$/);
    await expect(page.getByRole('heading', { name: 'Teams', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  });
});
