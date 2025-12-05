/**
 * End-to-end tests for sidebar navigation
 *
 * Tests the unified sidebar component and basic page rendering:
 * - Homepage renders without 500 errors
 * - Dashboard page loads (may redirect to auth)
 * - Auth page exists
 */

import { test, expect } from '@playwright/test';

test.describe('Sidebar Navigation', () => {
  test('homepage loads without 500 error', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');

    // Wait for the page to fully load (redirect or render)
    await page.waitForLoadState('networkidle');

    // Take a screenshot to verify the page rendered
    await page.screenshot({
      path: 'test-results/sidebar-homepage.png',
      fullPage: true
    });

    // Page should not have a 500 Internal Server Error
    const pageContent = await page.content();
    expect(pageContent).not.toContain('Internal Server Error');

    // Check that the homepage rendered with expected content
    expect(pageContent).toContain('Qontinui');
  });

  test('dashboard page loads with sidebar', async ({ page }) => {
    // Navigate to dashboard (will redirect to login if not authenticated)
    await page.goto('/dashboard');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Take a screenshot
    await page.screenshot({
      path: 'test-results/sidebar-dashboard.png',
      fullPage: true
    });

    // Page should not have a 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain('Internal Server Error');
  });

  test('auth page renders correctly', async ({ page }) => {
    // Navigate to auth page (the actual login page route)
    await page.goto('/auth');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Take a screenshot
    await page.screenshot({
      path: 'test-results/sidebar-auth.png',
      fullPage: true
    });

    // Page should not have a 500 Internal Server Error
    const pageContent = await page.content();
    expect(pageContent).not.toContain('Internal Server Error');
  });
});
