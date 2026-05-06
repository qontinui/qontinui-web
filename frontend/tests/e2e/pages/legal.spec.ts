/**
 * End-to-end tests for legal/policy pages
 *
 * Tests the public legal pages:
 * - Privacy Policy (/privacy)
 * - Extension Privacy Policy (/privacy-extension)
 * - Terms of Service (/terms)
 * - Acceptable Use Policy (/acceptable-use)
 * - Responsible Use FAQ (/responsible-use)
 *
 * These pages are public and do not require authentication.
 */

import { test, expect } from "@playwright/test";

test.describe("Privacy Policy (/privacy)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/privacy");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/legal-privacy.png",
      fullPage: true,
    });
  });

  test("displays correct heading", async ({ page }) => {
    await page.goto("/privacy");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", { name: "Privacy Policy" });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows last updated date", async ({ page }) => {
    await page.goto("/privacy");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText(/last updated/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("contains key sections", async ({ page }) => {
    await page.goto("/privacy");
    await page.waitForLoadState("domcontentloaded");

    // Verify key section headings
    await expect(page.getByText("1. Introduction")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("2. Data Controller")).toBeVisible();
    await expect(page.getByText("3. Information We Collect")).toBeVisible();
    await expect(
      page.getByText("4. How We Use Your Information")
    ).toBeVisible();
    await expect(page.getByText("5. Data Storage and Security")).toBeVisible();
    await expect(page.getByText("9. Your Rights (GDPR)")).toBeVisible();
    await expect(page.getByText("13. Contact Us")).toBeVisible();
  });

  test("contains GDPR reference", async ({ page }) => {
    await page.goto("/privacy");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).toContain("GDPR");
    expect(pageContent).toContain("contact@qontinui.com");
  });
});

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
    await expect(page.getByText("Data Collection")).toBeVisible();
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
      page.getByRole("heading", { name: "Open Source" })
    ).toBeVisible({ timeout: 10000 });

    const githubLink = page.getByRole("link", {
      name: /github\.com\/qontinui\/qontinui-runner/i,
    });
    await expect(githubLink).toBeVisible();
  });
});

test.describe("Terms of Service (/terms)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/terms");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/legal-terms.png",
      fullPage: true,
    });
  });

  test("displays correct heading", async ({ page }) => {
    await page.goto("/terms");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", { name: "Terms of Service" });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows last updated date", async ({ page }) => {
    await page.goto("/terms");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText(/last updated/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("contains key sections", async ({ page }) => {
    await page.goto("/terms");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("1. Agreement to Terms")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("2. Description of Service")).toBeVisible();
    await expect(
      page.getByText("5. Responsible Use and User Obligations")
    ).toBeVisible();
    await expect(page.getByText("7. Prohibited Uses")).toBeVisible();
    await expect(page.getByText("12. Disclaimer of Warranties")).toBeVisible();
    await expect(page.getByText("13. Limitation of Liability")).toBeVisible();
  });

  test("has link to acceptable use policy", async ({ page }) => {
    await page.goto("/terms");
    await page.waitForLoadState("domcontentloaded");

    const aupLink = page.getByRole("link", {
      name: /acceptable use policy/i,
    });
    await expect(aupLink).toBeVisible({ timeout: 10000 });
    await expect(aupLink).toHaveAttribute("href", "/acceptable-use");
  });

  test("contains Important Reminders section", async ({ page }) => {
    await page.goto("/terms");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Important Reminders")).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("Acceptable Use Policy (/acceptable-use)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/acceptable-use");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/legal-acceptable-use.png",
      fullPage: true,
    });
  });

  test("displays correct heading", async ({ page }) => {
    await page.goto("/acceptable-use");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: "Acceptable Use Policy",
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows last updated date", async ({ page }) => {
    await page.goto("/acceptable-use");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText(/last updated/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("contains Prohibited Uses section", async ({ page }) => {
    await page.goto("/acceptable-use");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("3. Prohibited Uses")).toBeVisible({
      timeout: 10000,
    });

    // Sub-sections
    await expect(page.getByText("3.1 Illegal Activities")).toBeVisible();
    await expect(
      page.getByText("3.4 Anti-Cheat and Security Circumvention")
    ).toBeVisible();
  });

  test("contains Acceptable and Recommended Uses section", async ({ page }) => {
    await page.goto("/acceptable-use");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("4. Acceptable and Recommended Uses")
    ).toBeVisible({ timeout: 10000 });

    // Sub-sections
    await expect(page.getByText("4.1 Personal Productivity")).toBeVisible();
    await expect(
      page.getByText("4.2 Software Development and Testing")
    ).toBeVisible();
  });

  test("contains Gray Areas warning section", async ({ page }) => {
    await page.goto("/acceptable-use");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("5. Gray Areas - Use with Extreme Caution")
    ).toBeVisible({ timeout: 10000 });
  });

  test("contains Key Takeaways section", async ({ page }) => {
    await page.goto("/acceptable-use");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Key Takeaways")).toBeVisible({
      timeout: 10000,
    });
  });

  test("contains Enforcement section", async ({ page }) => {
    await page.goto("/acceptable-use");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("7. Enforcement and Violations")).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("Responsible Use FAQ (/responsible-use)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/responsible-use");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/legal-responsible-use.png",
      fullPage: true,
    });
  });

  test("displays correct heading", async ({ page }) => {
    await page.goto("/responsible-use");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: "Responsible Use FAQ",
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows last updated date", async ({ page }) => {
    await page.goto("/responsible-use");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText(/last updated/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows Welcome to Qontinui introduction", async ({ page }) => {
    await page.goto("/responsible-use");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Welcome to Qontinui")).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows Quick Reference section with safe vs risky use", async ({
    page,
  }) => {
    await page.goto("/responsible-use");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("Quick Reference: Safe vs. Risky Use")
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Recommended (Low Risk)")).toBeVisible();
    await expect(
      page.getByText("High Risk (Proceed with Caution)")
    ).toBeVisible();
  });

  test("contains major FAQ sections", async ({ page }) => {
    await page.goto("/responsible-use");
    await page.waitForLoadState("domcontentloaded");

    // Major section headings
    await expect(page.getByText("Getting Started")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Legal and Safety")).toBeVisible();
    await expect(page.getByText("Gaming Automation")).toBeVisible();
    await expect(page.getByText("Technical Questions")).toBeVisible();
    await expect(page.getByText("Pricing and Plans")).toBeVisible();
    await expect(page.getByText("Best Practices")).toBeVisible();
  });

  test("contains Important Disclaimers section", async ({ page }) => {
    await page.goto("/responsible-use");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Important Disclaimers")).toBeVisible({
      timeout: 10000,
    });
  });

  test("has links to Terms of Service and Acceptable Use Policy", async ({
    page,
  }) => {
    await page.goto("/responsible-use");
    await page.waitForLoadState("domcontentloaded");

    const termsLink = page
      .getByRole("link", { name: /terms of service/i })
      .first();
    await expect(termsLink).toBeVisible({ timeout: 10000 });

    const aupLink = page
      .getByRole("link", { name: /acceptable use policy/i })
      .first();
    await expect(aupLink).toBeVisible();
  });
});
