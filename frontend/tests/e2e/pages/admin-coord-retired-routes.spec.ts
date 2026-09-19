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

  test("navigating to the retired alerts page lands on Dev Ops", async ({
    page,
  }) => {
    await page.goto(RETIRED);
    // Auto-waiting: the retired path never renders.
    await expect(page).not.toHaveURL(new RegExp(`${RETIRED}(\\?|#|/|$)`));
    const landed = new URL(page.url()).pathname;
    // A user the console sends elsewhere (the tolerated non-admin branch the
    // other admin specs share) is not this spec's subject; one it keeps must
    // be on the Dev Ops overview, rendering it.
    if (landed.startsWith("/admin/coord")) {
      expect(landed).toBe(DESTINATION);
      await expect(page.getByTestId("coord-devops-page")).toBeVisible();
    }
  });
});
