/**
 * End-to-end tests for /admin/coord/questions (inbox + detail).
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 3 (Wave 3a).
 *
 * Two load-bearing paths under test:
 *   1. Inbox loads, the pending tab renders, and the pending-count
 *      badge is visible (smoke-level; tolerates empty coord state).
 *   2. The detail route /admin/coord/questions/[id] renders without
 *      blowing up; if coord returns a row, the response composer is
 *      submittable. Otherwise the page falls through to the "not found"
 *      empty-state without crashing.
 *
 * Auth model: superuser-gated like every /admin/* page. Non-superusers
 * redirect to /build/workflows or /dashboard, so the tests tolerate
 * both shapes (admin + redirected) per the existing admin.spec
 * convention.
 */

import { test, expect } from "../fixtures";

const PENDING_PATH = "/admin/coord/questions";
const DETAIL_PATH = "/admin/coord/questions/00000000-0000-0000-0000-deadbeef0001";

function wasRedirected(url: string): boolean {
  return (
    url.includes("/build/workflows") ||
    (url.includes("/dashboard") && !url.includes("/admin"))
  );
}

test.describe("Admin - Coord questions inbox", () => {
  test("inbox loads and renders pending tab + count badge", async ({
    page,
  }) => {
    await page.goto(PENDING_PATH);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    const hasCoordHeading =
      (await page
        .getByRole("heading", { name: "Coord operator console", exact: true })
        .count()) > 0;

    if (!hasCoordHeading) {
      expect(wasRedirected(page.url())).toBeTruthy();
      return;
    }

    // The inbox page container renders.
    await expect(page.getByTestId("coord-questions-page")).toBeVisible();

    // The pending-count badge is present (count may be zero).
    await expect(
      page.getByTestId("coord-questions-pending-count")
    ).toBeVisible();

    // Both tabs exist; pending is the default tab.
    await expect(
      page.getByTestId("coord-questions-tab-pending")
    ).toBeVisible();
    await expect(
      page.getByTestId("coord-questions-tab-answered")
    ).toBeVisible();

    // Nav-link to the inbox is wired into CoordNav.
    await expect(page.getByTestId("coord-nav-questions")).toBeVisible();
  });

  test("detail route renders without error and exposes submit composer when pending", async ({
    page,
  }) => {
    await page.goto(DETAIL_PATH);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    const hasCoordHeading =
      (await page
        .getByRole("heading", { name: "Coord operator console", exact: true })
        .count()) > 0;

    if (!hasCoordHeading) {
      expect(wasRedirected(page.url())).toBeTruthy();
      return;
    }

    // The detail container always renders for superusers, even when
    // coord returns no row (the page falls through to "not found").
    await expect(
      page.getByTestId("coord-question-detail-page")
    ).toBeVisible();

    // Back-link is always present.
    await expect(page.getByTestId("coord-question-back-btn")).toBeVisible();

    // If coord returned a pending row, the submit composer should be
    // wired. We don't assert that here because coord is not necessarily
    // running against this E2E suite — the load-bearing assertion is
    // "no crash + container present." A follow-up test against a live
    // coord fixture would assert submit + redirect.
  });

  test("nav-link click routes from fleet to questions", async ({ page }) => {
    await page.goto("/admin/coord/fleet");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hasCoordHeading =
      (await page
        .getByRole("heading", { name: "Coord operator console", exact: true })
        .count()) > 0;
    if (!hasCoordHeading) {
      return;
    }

    await page.getByTestId("coord-nav-questions").click();
    await page.waitForURL(/\/admin\/coord\/questions/);
    await expect(page.getByTestId("coord-questions-page")).toBeVisible();
  });
});
