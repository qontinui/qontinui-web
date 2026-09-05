/* eslint-disable react-hooks/rules-of-hooks */
/**
 * Custom Playwright fixtures for integration testing
 *
 * Authentication Strategy:
 * - Most tests use storageState from auth.setup.ts (already authenticated)
 * - Tests that need to test login flow use the login-specific projects (no storageState)
 * - The authenticatedPage fixture is now simplified since storageState handles auth
 *
 * For tests that run WITH storageState (most tests):
 * - Just use the regular `page` fixture - you're already logged in
 *
 * For tests that run WITHOUT storageState (login tests):
 * - Use performManualLogin() if you need to log in during the test
 */

import { test as base, Page, expect as baseExpect } from "@playwright/test";
import { TEST_USER } from "./test-credentials";

/**
 * Replaces the old `waitForTimeout(2000)` "wait for auth state to settle"
 * (plan 2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time).
 */
const AUTH_SETTLE_TIMEOUT = 6000;

// Define custom fixture types
type IntegrationTestFixtures = {
  authenticatedPage: Page;
};

/**
 * Perform manual login via the UI dialog
 * Use this in login tests or when storageState is not available
 */
async function performManualLogin(page: Page): Promise<void> {
  console.log("[Playwright] Performing manual login");

  // Check if already on a page, if not navigate to homepage
  if (page.url() === "about:blank") {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
  }

  // Check if already logged in
  const userEmailVisible = await page
    .getByText(TEST_USER.email)
    .isVisible()
    .catch(() => false);
  if (userEmailVisible) {
    console.log("[Playwright] Already logged in, skipping manual login");
    return;
  }

  // Open login dialog
  const signInButton = page.getByRole("button", { name: /sign in/i });
  await baseExpect(signInButton).toBeVisible({ timeout: 30000 });
  await signInButton.click();

  // Wait for dialog
  const dialog = page.getByRole("dialog");
  await baseExpect(dialog).toBeVisible({ timeout: 5000 });

  // Fill credentials
  await page.getByLabel(/username/i).fill(TEST_USER.username);
  await page.getByLabel(/password/i).fill(TEST_USER.password);

  // Click Sign In button inside dialog (be specific to avoid clicking header button)
  await dialog.getByRole("button", { name: /sign in/i }).click();

  // Wait for login to complete (dialog closes)
  await baseExpect(dialog).not.toBeVisible({ timeout: 15000 });

  console.log("[Playwright] Manual login complete");
}

/**
 * Extended test with custom fixtures
 */
export const test = base.extend<IntegrationTestFixtures>({
  /**
   * `page`, with `goto` retried ONCE on the dev server's connection-drop
   * family (`CONNECTION_REFUSED`, `CONNECTION_RESET`, `EMPTY_RESPONSE`).
   *
   * The E2E stack runs against `next dev`, which under a long single-worker
   * run accepts-and-closes or resets a connection now and then — three runs
   * of the 23-file changed-specs lane on web#1265 (2026-09-05) each failed a
   * DIFFERENT test's first `page.goto` this way, before any assertion ran.
   * `helpers/network-retry.ts` already papers over exactly this for the three
   * specs that call it; this puts the same narrow retry under every spec that
   * takes `test` from this fixture, so the swallow stays narrow (only the
   * matched error, only once) and a real failure still surfaces at once.
   * The one-second pause is a retry BACKOFF, not a wait for state — the one
   * legitimate fixed delay (plan 2026-09-05-web-e2e-fixed-sleeps-…, §3).
   */
  page: async ({ page }, use) => {
    const rawGoto = page.goto.bind(page);
    const retryable = /CONNECTION_(REFUSED|RESET)|EMPTY_RESPONSE/i;
    page.goto = (async (url: string, options?: Parameters<Page["goto"]>[1]) => {
      try {
        return await rawGoto(url, options);
      } catch (e) {
        if (e instanceof Error && retryable.test(e.message)) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return await rawGoto(url, options);
        }
        throw e;
      }
    }) as Page["goto"];
    await use(page);
  },

  /**
   * Authenticated page fixture
   *
   * With storageState:
   * - The page is already authenticated from the stored cookies
   * - Just navigate to the page and verify the user is logged in
   *
   * Without storageState (login tests):
   * - Performs manual login
   */
  authenticatedPage: async ({ page }, use) => {
    // Navigate to homepage
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Check if we're already authenticated (storageState loaded)
    const userEmailVisible = await page
      .getByText(TEST_USER.email)
      .isVisible()
      .catch(() => false);

    if (!userEmailVisible) {
      // Not authenticated - storageState might not be loaded (login tests)
      // Check if Sign In button is visible
      const signInVisible = await page
        .getByRole("button", { name: /sign in/i })
        .isVisible()
        .catch(() => false);

      if (signInVisible) {
        // Need to log in manually
        console.log(
          "[Playwright] Not authenticated (no storageState), performing manual login"
        );
        await performManualLogin(page);
      }
      // Otherwise the auth state is still settling — the assertion below
      // auto-waits for it.
    }

    // Verify we're logged in
    await baseExpect(page.getByText(TEST_USER.email)).toBeVisible({
      timeout: 10000,
    });

    await use(page);
  },
});

export { expect } from "@playwright/test";

/**
 * Exported helper functions for tests that don't use the fixture
 */
export { performManualLogin };

/**
 * Login helper for tests that need to authenticate
 * With storageState, this just verifies the user is logged in
 * Without storageState, it performs manual login
 */
export async function loginUser(page: Page): Promise<void> {
  // Check if already at a real page
  if (page.url() === "about:blank") {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
  }

  // Check if already authenticated (storageState)
  const userEmailVisible = await page
    .getByText(TEST_USER.email)
    .isVisible()
    .catch(() => false);

  if (userEmailVisible) {
    console.log("[Playwright] Already authenticated via storageState");
    return;
  }

  // Check if Sign In button is visible (need to log in)
  const signInVisible = await page
    .getByRole("button", { name: /sign in/i })
    .isVisible()
    .catch(() => false);

  if (signInVisible) {
    await performManualLogin(page);
  } else {
    // The auth state is still settling: it lands on the signed-in user or
    // on the Sign In button. Bounded wait for either, tolerated, then the
    // same check as before.
    await page
      .getByText(TEST_USER.email)
      .or(page.getByRole("button", { name: /sign in/i }))
      .first()
      .waitFor({ state: "visible", timeout: AUTH_SETTLE_TIMEOUT })
      .catch(() => null);
    const stillNeedsLogin = await page
      .getByRole("button", { name: /sign in/i })
      .isVisible()
      .catch(() => false);
    if (stillNeedsLogin) {
      await performManualLogin(page);
    }
  }

  // Verify login succeeded
  await baseExpect(page.getByText(TEST_USER.email)).toBeVisible({
    timeout: 10000,
  });
}

/**
 * @deprecated Use performManualLogin instead
 * Kept for backward compatibility
 */
export async function waitForAutoLogin(
  page: Page,
  timeout = 15000
): Promise<boolean> {
  console.warn(
    "[Playwright] waitForAutoLogin is deprecated - storageState handles authentication now"
  );
  // Same contract as the old 200 ms poll loop — true once the user's email
  // is visible within `timeout`, false otherwise — as one bounded wait.
  return page
    .getByText(TEST_USER.email)
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}
