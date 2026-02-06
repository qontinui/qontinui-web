/**
 * Authentication setup for Playwright tests.
 *
 * This file logs in once and saves the authentication state (cookies, localStorage)
 * to a file. Other tests can reuse this state to start already authenticated,
 * avoiding the need to log in for every test.
 *
 * Credentials are configurable via environment variables:
 * - PLAYWRIGHT_TEST_USERNAME: Username or email for login
 * - PLAYWRIGHT_TEST_PASSWORD: Password for login
 *
 * Falls back to the standard dev credentials from test-credentials.ts
 */

import { test as setup, expect } from "@playwright/test";
import { TEST_USER } from "./test-credentials";
import { STORAGE_STATE_PATH } from "./auth.constants";

// Get credentials from environment or use defaults
const getCredentials = () => {
  const username = process.env.PLAYWRIGHT_TEST_USERNAME || TEST_USER.username;
  const password = process.env.PLAYWRIGHT_TEST_PASSWORD || TEST_USER.password;
  return { username, password };
};

setup("authenticate", async ({ page }) => {
  const { username, password } = getCredentials();

  console.log(`[Auth Setup] Logging in as: ${username}`);

  // Navigate to homepage
  await page.goto("/");
  // Use domcontentloaded instead of networkidle because the app has continuous polling
  // on /api/ui-bridge/commands that prevents networkidle from ever completing
  await page.waitForLoadState("domcontentloaded");

  // Open login dialog
  const signInButton = page.getByRole("button", { name: /sign in/i });
  await expect(signInButton).toBeVisible({ timeout: 30000 });
  await signInButton.click();

  // Wait for dialog
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Fill credentials and submit
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await dialog.getByRole("button", { name: /sign in/i }).click();

  // Wait for dialog to close (indicates successful login)
  await expect(dialog).not.toBeVisible({ timeout: 15000 });

  // Verify we're authenticated by checking for user-specific content
  // Wait for either redirect OR authenticated state on current page
  await page.waitForTimeout(1000); // Brief wait for state to settle

  // Save the authenticated state
  await page.context().storageState({ path: STORAGE_STATE_PATH });

  console.log(
    `[Auth Setup] Authentication state saved to ${STORAGE_STATE_PATH}`
  );
});
