/**
 * Retired coord console routes still land somewhere real.
 *
 * `/admin/coord/alerts` was deleted by plan
 * `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
 * (D7, Phase 8): the raw alert list is agents' work, and the operator's
 * rollup of it is the Conditions panel on the Dev Ops overview.
 * `next.config.mjs` 308s the old path there so bookmarks and older links do
 * not dead-end. The unit test `admin/coord/devops/alerts-retired.test.ts`
 * pins the config entry; this spec proves the RUNNING app honours it.
 *
 * This file is the one live reference to the retired path the unit test's
 * sweep allows, because asserting a redirect has to name its source.
 *
 * No fixed sleeps: every wait is an auto-waiting assertion.
 */

import { test, expect } from "../fixtures";

const RETIRED = "/admin/coord/alerts";
const DESTINATION = "/admin/coord/devops";

test.describe("Admin - Coord retired routes", () => {
  test("the retired alerts page answers a permanent redirect to Dev Ops", async ({
    page,
  }) => {
    const response = await page.request.get(RETIRED, { maxRedirects: 0 });
    // 308: permanent, method-preserving — `permanent: true` in next.config.
    expect(response.status()).toBe(308);
    const location = response.headers()["location"] ?? "";
    expect(new URL(location, "http://placeholder").pathname).toBe(DESTINATION);
  });

  test("an authenticated member lands on the Dev Ops page", async ({
    page,
  }) => {
    await page.goto(RETIRED);
    // `/admin/coord/*` does not admin-gate VIEWING (coord/layout.tsx): any
    // authenticated member renders the page, so the redirect's destination is
    // exactly where this storageState user must end up.
    await expect(page).toHaveURL(new RegExp(`${DESTINATION}(\\?|#|$)`));
    await expect(page.getByTestId("coord-devops-page")).toBeVisible();
  });

  test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("is sent to sign in with the DESTINATION as `next`, never the retired path", async ({
      page,
    }) => {
      await page.goto(RETIRED);
      // The 308 runs before the auth gate, so `AppAuthGate` builds `next`
      // from the pathname it sees — Dev Ops. A `next` naming the retired path
      // would mean the redirect did not run first, and signing in would land
      // on a route that no longer exists.
      await expect(page).toHaveURL(/\/login\?/);
      const next = new URL(page.url()).searchParams.get("next");
      expect(next).toBe(DESTINATION);
    });
  });
});
