/**
 * E2E tests for Organization pages
 *
 * Tests the organizations list, creation form, detail view, members page,
 * and settings page. Uses a non-existent org ID for detail/members/settings
 * pages to verify error handling.
 */

import { test, expect } from "../fixtures";

test.describe("Organizations List Page", () => {
  test("loads without errors and shows heading", async ({ page }) => {
    await page.goto("/organizations");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-organizations-list.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify the Organizations heading is present
    await expect(
      page.getByRole("heading", { name: "Organizations" })
    ).toBeVisible({ timeout: 15000 });
  });

  test("shows Create Organization button", async ({ page }) => {
    await page.goto("/organizations");
    await page.waitForLoadState("domcontentloaded");

    // Create Organization button should be visible
    await expect(page.getByText("Create Organization").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows organization cards or empty state", async ({ page }) => {
    await page.goto("/organizations");
    await page.waitForLoadState("domcontentloaded");

    // Wait for data to load
    await page.waitForTimeout(3000);

    // Should display either organization cards or the empty state message
    const hasOrgs = await page
      .getByText("Your Organizations")
      .isVisible()
      .catch(() => false);

    if (hasOrgs) {
      // Verify "Your Organizations" section heading
      await expect(page.getByText("Your Organizations")).toBeVisible();
    }

    // Either way, the stats cards should be visible
    await expect(page.getByText("Total Organizations")).toBeVisible({
      timeout: 10000,
    });

    await page.screenshot({
      path: "test-results/pages-organizations-content.png",
      fullPage: true,
    });
  });

  test("shows stats summary cards", async ({ page }) => {
    await page.goto("/organizations");
    await page.waitForLoadState("domcontentloaded");

    // Verify stats cards are present
    await expect(page.getByText("Total Organizations")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Total Members")).toBeVisible();
    await expect(page.getByText("Owned by You")).toBeVisible();
  });
});

test.describe("New Organization Page", () => {
  test("loads without errors and shows creation form", async ({ page }) => {
    await page.goto("/organizations/new");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-organizations-new.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify the Create New Organization heading
    await expect(page.getByText("Create New Organization")).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows name input and description fields", async ({ page }) => {
    await page.goto("/organizations/new");
    await page.waitForLoadState("domcontentloaded");

    // Organization Name input should be visible
    const nameInput = page.locator("#name");
    await expect(nameInput).toBeVisible({ timeout: 15000 });

    // Organization Slug field (auto-generated, read-only)
    const slugInput = page.locator("#slug");
    await expect(slugInput).toBeVisible();

    // Description textarea
    const descriptionInput = page.locator("#description");
    await expect(descriptionInput).toBeVisible();
  });

  test("shows create and cancel buttons", async ({ page }) => {
    await page.goto("/organizations/new");
    await page.waitForLoadState("domcontentloaded");

    // Create Organization button (in the actions area)
    const createButtons = page.getByText("Create Organization");
    // There may be multiple (heading + button), check button specifically
    await expect(createButtons.last()).toBeVisible({ timeout: 15000 });

    // Cancel button
    await expect(page.getByText("Cancel").first()).toBeVisible();
  });

  test("auto-generates slug from name", async ({ page }) => {
    await page.goto("/organizations/new");
    await page.waitForLoadState("domcontentloaded");

    // Type a name
    const nameInput = page.locator("#name");
    await expect(nameInput).toBeVisible({ timeout: 15000 });
    await nameInput.fill("Test Organization");

    // Wait for slug to be generated
    await page.waitForTimeout(500);

    // Slug should be auto-generated
    const slugInput = page.locator("#slug");
    const slugValue = await slugInput.inputValue();
    expect(slugValue).toBe("test-organization");
  });

  test("shows preview when name is entered", async ({ page }) => {
    await page.goto("/organizations/new");
    await page.waitForLoadState("domcontentloaded");

    // Type a name to trigger preview
    const nameInput = page.locator("#name");
    await expect(nameInput).toBeVisible({ timeout: 15000 });
    await nameInput.fill("My Test Org");

    // Wait for preview to appear
    await page.waitForTimeout(500);

    // Preview section should appear
    await expect(page.getByText("Preview")).toBeVisible();
    await expect(page.getByText("My Test Org").nth(1)).toBeVisible();
  });

  test("shows back to organizations link", async ({ page }) => {
    await page.goto("/organizations/new");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Back to Organizations")).toBeVisible({
      timeout: 15000,
    });
  });
});

test.describe("Organization Detail Page", () => {
  // Use a fake UUID to test error handling since we may not have a real org
  const fakeOrgId = "00000000-0000-0000-0000-000000000000";

  test("loads without 500 error for invalid org", async ({ page }) => {
    await page.goto(`/organizations/${fakeOrgId}`);
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-organization-detail.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Should show loading state or error message
    // Either "Loading organization..." or "Failed to load organization" or the org details
    const hasContent = await Promise.race([
      page
        .getByText("Loading organization")
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false),
      page
        .getByText("Failed to load organization")
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false),
      page
        .getByText("Back to Organizations")
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false),
    ]);

    expect(hasContent).toBe(true);
  });
});

test.describe("Organization Members Page", () => {
  const fakeOrgId = "00000000-0000-0000-0000-000000000000";

  test("loads without 500 error for invalid org", async ({ page }) => {
    await page.goto(`/organizations/${fakeOrgId}/members`);
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-organization-members.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });
});

test.describe("Organization Settings Page", () => {
  const fakeOrgId = "00000000-0000-0000-0000-000000000000";

  test("loads without 500 error for invalid org", async ({ page }) => {
    await page.goto(`/organizations/${fakeOrgId}/settings`);
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-organization-settings.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // For an invalid org, should show error or redirect
    // For a valid org where user is not owner, should show access denied
    // Either "Organization Settings" heading, "Organization not found",
    // "Only organization owners", or "Back to Organizations"
    const hasContent = await Promise.race([
      page
        .getByText("Organization Settings")
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false),
      page
        .getByText("Organization not found")
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false),
      page
        .getByText("Only organization owners")
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false),
      page
        .getByText("Back to Organizations")
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false),
      page
        .getByText("Loading settings")
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false),
    ]);

    expect(hasContent).toBe(true);
  });
});
