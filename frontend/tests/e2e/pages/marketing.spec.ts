/**
 * End-to-end tests for marketing/public pages
 *
 * Tests the public-facing marketing pages:
 * - Homepage (/) - branding, sign-in button, feature cards
 * - Runner page (/runner) - hero section, features, download CTAs
 * - Runner download page (/runner/download) - platform detection, download buttons, system requirements
 *
 * These pages do not require authentication.
 */

import { test, expect } from "@playwright/test";

test.describe("Homepage (/)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/marketing-homepage.png",
      fullPage: true,
    });
  });

  test("displays Qontinui branding", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // The header contains "ontinui" text next to the logo
    const pageContent = await page.content();
    expect(pageContent).toContain("ontinui");

    // Logo image should be present
    const logo = page.locator('img[alt="Qontinui"]');
    await expect(logo).toBeVisible({ timeout: 10000 });
  });

  test("shows Sign In button when not authenticated", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Clear any auth state
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    const signInButton = page.getByRole("button", { name: /sign in/i });
    await expect(signInButton).toBeVisible({ timeout: 10000 });
  });

  test("shows feature cards in key features section", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Verify key feature cards are present
    await expect(page.getByText("Orchestrated Workflows")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Self-Correcting AI")).toBeVisible();
    await expect(page.getByText("Error Monitoring")).toBeVisible();
    await expect(page.getByText("UI Bridge Feedback")).toBeVisible();
    await expect(page.getByText("Persistent Knowledge")).toBeVisible();
  });

  test("has download button in hero section", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // The hero section has a Download button
    const downloadButton = page
      .getByRole("button", { name: /download/i })
      .first();
    await expect(downloadButton).toBeVisible({ timeout: 10000 });
  });

  test("has View on GitHub link", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const githubButton = page.getByRole("button", { name: /github/i }).first();
    await expect(githubButton).toBeVisible({ timeout: 10000 });
  });

  test("shows How It Works section", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("How It Works")).toBeVisible({
      timeout: 10000,
    });

    // Verify the three steps
    await expect(page.getByText("Configure")).toBeVisible();
    await expect(page.getByText("Build")).toBeVisible();
    await expect(page.getByText("Run")).toBeVisible();
  });
});

test.describe("Runner Page (/runner)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/runner");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/marketing-runner.png",
      fullPage: true,
    });
  });

  test("displays hero section with title", async ({ page }) => {
    await page.goto("/runner");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", { name: /qontinui runner/i });
    await expect(heading).toBeVisible({ timeout: 10000 });

    // Verify subtitle/description
    await expect(page.getByText(/AI development desktop app/i)).toBeVisible();
  });

  test("shows feature cards", async ({ page }) => {
    await page.goto("/runner");
    await page.waitForLoadState("domcontentloaded");

    // Feature section heading
    await expect(
      page.getByText("Built for AI-Assisted Development")
    ).toBeVisible({ timeout: 10000 });

    // Individual feature cards
    await expect(page.getByText("Orchestrated Workflows")).toBeVisible();
    await expect(page.getByText("Self-Correcting AI")).toBeVisible();
    await expect(page.getByText("Error Monitoring")).toBeVisible();
    await expect(page.getByText("UI Bridge Feedback")).toBeVisible();
    await expect(page.getByText("Multi-Provider")).toBeVisible();
    await expect(page.getByText("Persistent Knowledge")).toBeVisible();
  });

  test("has Download Now CTA linking to download page", async ({ page }) => {
    await page.goto("/runner");
    await page.waitForLoadState("domcontentloaded");

    const downloadLink = page.getByRole("link", { name: /download now/i });
    await expect(downloadLink).toBeVisible({ timeout: 10000 });
    await expect(downloadLink).toHaveAttribute("href", "/runner/download");
  });

  test("has Documentation link", async ({ page }) => {
    await page.goto("/runner");
    await page.waitForLoadState("domcontentloaded");

    const docsLink = page.getByRole("link", { name: /documentation/i }).first();
    await expect(docsLink).toBeVisible({ timeout: 10000 });
    await expect(docsLink).toHaveAttribute("href", "/docs/runner");
  });

  test("shows How it works section with steps", async ({ page }) => {
    await page.goto("/runner");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /how it works/i })
    ).toBeVisible({ timeout: 10000 });

    // Verify steps
    await expect(page.getByText("Configure your AI provider")).toBeVisible();
    await expect(page.getByText("Build agentic workflows")).toBeVisible();
    await expect(page.getByText("Run with verification")).toBeVisible();
    await expect(page.getByText("Monitor and iterate")).toBeVisible();
  });

  test("shows Security & Code Signing section", async ({ page }) => {
    await page.goto("/runner");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Security & Code Signing")).toBeVisible({
      timeout: 10000,
    });

    await expect(page.getByText(/SignPath Foundation/i)).toBeVisible();
  });

  test("has bottom CTA section", async ({ page }) => {
    await page.goto("/runner");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Ready to get started?")).toBeVisible({
      timeout: 10000,
    });

    const downloadForFree = page.getByRole("link", {
      name: /download for free/i,
    });
    await expect(downloadForFree).toBeVisible();
  });
});

test.describe("Runner Download Page (/runner/download)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/runner/download");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/marketing-runner-download.png",
      fullPage: true,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/runner/download");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /download qontinui runner/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows latest version info", async ({ page }) => {
    await page.goto("/runner/download");
    await page.waitForLoadState("domcontentloaded");

    // Version badge should be present
    await expect(page.getByText(/latest version/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/1\.0\.0-beta/i)).toBeVisible();
  });

  test("detects platform and shows platform callout", async ({ page }) => {
    await page.goto("/runner/download");
    await page.waitForLoadState("domcontentloaded");

    // Since tests run in a browser, platform detection should work
    // The "Detected Platform" callout should appear
    const detectedPlatform = page.getByText(/detected platform/i);
    await expect(detectedPlatform).toBeVisible({ timeout: 10000 });
  });

  test("shows Windows download section", async ({ page }) => {
    await page.goto("/runner/download");
    await page.waitForLoadState("domcontentloaded");

    // Windows section should be present
    await expect(page.getByText("Windows")).toBeVisible({ timeout: 10000 });

    // Download buttons for Windows
    await expect(page.getByText(/Windows Installer \(MSI\)/i)).toBeVisible();
    await expect(page.getByText(/Windows Installer \(EXE\)/i)).toBeVisible();
  });

  test("shows macOS and Linux coming soon sections", async ({ page }) => {
    await page.goto("/runner/download");
    await page.waitForLoadState("domcontentloaded");

    // macOS and Linux sections should show "Coming Soon"
    const comingSoonBadges = page.getByText("Coming Soon");
    expect(await comingSoonBadges.count()).toBeGreaterThanOrEqual(2);
  });

  test("shows System Requirements section", async ({ page }) => {
    await page.goto("/runner/download");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /system requirements/i })
    ).toBeVisible({ timeout: 10000 });

    // Platform-specific requirements
    await expect(page.getByText("Windows 10 or later")).toBeVisible();
    await expect(page.getByText(/64-bit processor/i).first()).toBeVisible();
    await expect(page.getByText(/4 GB RAM/i).first()).toBeVisible();
  });

  test("shows Installation Instructions section", async ({ page }) => {
    await page.goto("/runner/download");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /installation instructions/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test("has GitHub Releases link", async ({ page }) => {
    await page.goto("/runner/download");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /github releases/i })
    ).toBeVisible({ timeout: 10000 });

    const viewOnGithub = page.getByRole("link", { name: /view on github/i });
    await expect(viewOnGithub).toBeVisible();
  });

  test("has Need Help section with links", async ({ page }) => {
    await page.goto("/runner/download");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("heading", { name: /need help/i })).toBeVisible(
      { timeout: 10000 }
    );

    await expect(
      page.getByRole("link", { name: /documentation/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /report an issue/i })
    ).toBeVisible();
  });
});
