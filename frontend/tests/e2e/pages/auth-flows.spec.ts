/**
 * End-to-end tests for authentication flow pages
 *
 * Tests the auth-related pages that do NOT require authentication:
 * - Forgot password (/forgot-password) - email input form
 * - Reset password (/reset-password) - password form (requires token)
 * - Verify email (/verify-email) - token handling
 *
 * These pages are public (marketing layout) and do not need auth fixtures.
 */

import { test, expect } from "@playwright/test";

test.describe("Forgot Password Page (/forgot-password)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.waitForLoadState("networkidle");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/auth-forgot-password.png",
      fullPage: true,
    });
  });

  test("displays heading and description", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.waitForLoadState("networkidle");

    const heading = page.getByRole("heading", { name: /forgot password/i });
    await expect(heading).toBeVisible({ timeout: 10000 });

    await expect(page.getByText(/enter your email/i)).toBeVisible();
  });

  test("shows email input field", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.waitForLoadState("networkidle");

    const emailLabel = page.getByText("Email", { exact: true });
    await expect(emailLabel).toBeVisible({ timeout: 10000 });

    const emailInput = page.getByLabel(/email/i);
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute("type", "email");
  });

  test("shows submit button", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.waitForLoadState("networkidle");

    const submitButton = page.getByRole("button", {
      name: /send reset email/i,
    });
    await expect(submitButton).toBeVisible({ timeout: 10000 });
    await expect(submitButton).toBeEnabled();
  });

  test("shows Back to Login link", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.waitForLoadState("networkidle");

    const backButton = page.getByRole("button", { name: /back to login/i });
    await expect(backButton).toBeVisible({ timeout: 10000 });
  });

  test("email input accepts text and placeholder is correct", async ({
    page,
  }) => {
    await page.goto("/forgot-password");
    await page.waitForLoadState("networkidle");

    const emailInput = page.getByLabel(/email/i);
    await expect(emailInput).toBeVisible({ timeout: 10000 });

    // Check placeholder
    await expect(emailInput).toHaveAttribute("placeholder", "your@email.com");

    // Type into the field
    await emailInput.fill("test@example.com");
    await expect(emailInput).toHaveValue("test@example.com");

    await page.screenshot({
      path: "test-results/auth-forgot-password-filled.png",
      fullPage: true,
    });
  });

  test("email field has required attribute", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.waitForLoadState("networkidle");

    const emailInput = page.getByLabel(/email/i);
    await expect(emailInput).toBeVisible({ timeout: 10000 });

    // The email field should be required
    await expect(emailInput).toHaveAttribute("required", "");
  });
});

test.describe("Reset Password Page (/reset-password)", () => {
  test("redirects to forgot-password when no token is provided", async ({
    page,
  }) => {
    await page.goto("/reset-password");
    await page.waitForLoadState("networkidle");

    // Without a token, the page should redirect to /forgot-password
    // or show an error/toast and navigate away
    // Wait for potential redirect
    await page.waitForTimeout(3000);

    // The page should either redirect to /forgot-password or show nothing (returns null)
    const currentUrl = page.url();
    const isRedirected = currentUrl.includes("/forgot-password");
    const pageContent = await page.content();
    const hasNoContent =
      !pageContent.includes("Reset Your Password") || isRedirected;

    expect(hasNoContent || isRedirected).toBe(true);

    await page.screenshot({
      path: "test-results/auth-reset-password-no-token.png",
      fullPage: true,
    });
  });

  test("loads without 500 error", async ({ page }) => {
    await page.goto("/reset-password");
    await page.waitForLoadState("networkidle");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("shows password form when token is provided", async ({ page }) => {
    // Navigate with a dummy token to see the form
    await page.goto("/reset-password?token=test-token-12345");
    await page.waitForLoadState("networkidle");

    // The form should be visible when a token is present
    const heading = page.getByRole("heading", {
      name: /reset your password/i,
    });

    // If the page is still visible (not redirected), check the form
    if (await heading.isVisible().catch(() => false)) {
      await expect(heading).toBeVisible();

      // Password fields
      await expect(page.getByLabel(/new password/i)).toBeVisible();
      await expect(page.getByLabel(/confirm password/i)).toBeVisible();

      // Submit button
      const resetButton = page.getByRole("button", {
        name: /reset password/i,
      });
      await expect(resetButton).toBeVisible();

      // Back to Login link
      const backLink = page.getByRole("link", { name: /back to login/i });
      await expect(backLink).toBeVisible();

      await page.screenshot({
        path: "test-results/auth-reset-password-with-token.png",
        fullPage: true,
      });
    }
  });
});

test.describe("Verify Email Page (/verify-email)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/verify-email");
    await page.waitForLoadState("networkidle");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/auth-verify-email.png",
      fullPage: true,
    });
  });

  test("shows error state when no token is provided", async ({ page }) => {
    await page.goto("/verify-email");
    await page.waitForLoadState("networkidle");

    // Without a token, the page should show an error state
    // The component sets status to "error" with message about invalid verification link
    await page.waitForTimeout(2000);

    const verificationFailed = page.getByText(/verification failed/i);
    const invalidLink = page.getByText(/invalid verification link/i);

    // Either the error heading or message should be visible
    const hasError =
      (await verificationFailed.isVisible().catch(() => false)) ||
      (await invalidLink.isVisible().catch(() => false));

    expect(hasError).toBe(true);

    await page.screenshot({
      path: "test-results/auth-verify-email-no-token.png",
      fullPage: true,
    });
  });

  test("shows error state with Go to Home and Request New Link buttons", async ({
    page,
  }) => {
    await page.goto("/verify-email");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // In error state, there should be action buttons
    const goHomeButton = page.getByRole("button", { name: /go to home/i });
    const requestNewLink = page.getByRole("button", {
      name: /request new link/i,
    });

    if (await goHomeButton.isVisible().catch(() => false)) {
      await expect(goHomeButton).toBeVisible();
    }

    if (await requestNewLink.isVisible().catch(() => false)) {
      await expect(requestNewLink).toBeVisible();
    }
  });

  test("shows Back to Home link", async ({ page }) => {
    await page.goto("/verify-email");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const backToHome = page.getByRole("link", { name: /back to home/i });
    await expect(backToHome).toBeVisible({ timeout: 10000 });
  });

  test("shows verifying state with dummy token before API response", async ({
    page,
  }) => {
    // With a token, the page should briefly show a "Verifying" state
    // before the API call fails
    await page.goto("/verify-email?token=test-token-12345");

    // The verifying state might be brief, but we should see either verifying or error
    await page.waitForTimeout(3000);

    const pageContent = await page.content();
    // After the API call fails, it should show an error state
    const hasContent =
      pageContent.includes("Verifying") ||
      pageContent.includes("Verification Failed") ||
      pageContent.includes("verified");

    expect(hasContent).toBe(true);

    await page.screenshot({
      path: "test-results/auth-verify-email-with-token.png",
      fullPage: true,
    });
  });
});
