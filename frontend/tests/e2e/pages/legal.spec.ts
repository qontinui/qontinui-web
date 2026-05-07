/**
 * End-to-end tests for legal/policy pages
 *
 * Tests the public legal pages:
 * - Extension Privacy Policy (/privacy-extension)
 *
 * The /privacy, /terms, /acceptable-use, and /responsible-use routes
 * were removed; only the browser-extension privacy policy ships in the
 * web app today.
 *
 * These pages are public and do not require authentication.
 */

import { test, expect } from "@playwright/test";

test.describe("Extension Privacy Policy (/privacy-extension)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/privacy-extension");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/legal-privacy-extension.png",
      fullPage: true,
    });
  });

  test("displays correct heading", async ({ page }) => {
    await page.goto("/privacy-extension");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /privacy policy for qontinui capture browser extension/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("contains key sections", async ({ page }) => {
    await page.goto("/privacy-extension");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Overview")).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("heading", { name: "Data Collection" })
    ).toBeVisible();
    await expect(page.getByText("Permissions Explained")).toBeVisible();
    await expect(page.getByText("User Control")).toBeVisible();
    await expect(page.getByText("Data Storage")).toBeVisible();
  });

  test("emphasizes data never leaves the machine", async ({ page }) => {
    await page.goto("/privacy-extension");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Data never leaves your machine.")).toBeVisible(
      { timeout: 10000 }
    );
  });

  test("lists what is NOT collected", async ({ page }) => {
    await page.goto("/privacy-extension");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("We do not collect personal information")
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("We do not track your browsing history")
    ).toBeVisible();
    await expect(
      page.getByText("We do not transmit any data to external servers")
    ).toBeVisible();
  });

  test("has Open Source section with GitHub link", async ({ page }) => {
    await page.goto("/privacy-extension");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: "Open Source", exact: true })
    ).toBeVisible({ timeout: 10000 });

    const githubLink = page.getByRole("link", {
      name: /github\.com\/qontinui\/qontinui-runner/i,
    });
    await expect(githubLink).toBeVisible();
  });
});
