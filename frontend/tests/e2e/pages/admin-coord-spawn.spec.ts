/**
 * End-to-end tests for /admin/coord/spawn (spawn-from-plan).
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 4 (Wave 4).
 *
 * Two load-bearing paths under test:
 *   1. The spawn page loads, the plans list renders, and clicking a
 *      "Spawn" button opens the SpawnModal with the plan pre-selected.
 *   2. Submitting the modal POSTs /api/v1/operations/agents/spawn and
 *      surfaces the coord response. We intercept the request so the
 *      test doesn't need live coord.
 *
 * Auth model: superuser-gated like every /admin/* page. Non-superusers
 * redirect to /build/workflows or /dashboard, so the tests tolerate
 * both shapes per admin-coord-questions.spec.ts.
 */

import { test, expect } from "../fixtures";

const SPAWN_PATH = "/admin/coord/spawn";

function wasRedirected(url: string): boolean {
  return (
    url.includes("/build/workflows") ||
    (url.includes("/dashboard") && !url.includes("/admin"))
  );
}

test.describe("Admin - Coord spawn-from-plan", () => {
  test("page loads and modal opens with plan pre-seeded", async ({ page }) => {
    // Stub the plans-list endpoint so we always have one row to spawn from.
    await page.route("**/api/v1/operations/plans*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plans: [
            {
              slug: "2026-05-19-coordinator-production-readiness",
              status: "in_progress",
              current_phase: "Phase 4",
              title: "Coord production readiness",
            },
          ],
          count: 1,
        }),
      });
    });
    // Stub fleet/health so the device dropdown has a row.
    await page.route("**/api/v1/operations/fleet/health", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          devices: [
            {
              device_id: "00000000-0000-0000-0000-deadbeefcafe",
              hostname: "test-host",
              status: "healthy",
            },
          ],
        }),
      });
    });

    await page.goto(SPAWN_PATH);
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

    // Spawn page + nav-link both render.
    await expect(page.getByTestId("coord-spawn-page")).toBeVisible();
    await expect(page.getByTestId("coord-nav-spawn")).toBeVisible();

    // The plan row is present + so is its Spawn button.
    await expect(page.getByTestId("coord-spawn-plans-list")).toBeVisible();
    const spawnBtn = page.getByTestId("coord-spawn-row-button").first();
    await expect(spawnBtn).toBeVisible();

    // Click Spawn → modal opens with the plan slug pre-filled.
    await spawnBtn.click();
    await expect(page.getByTestId("coord-spawn-modal")).toBeVisible();
    const planInput = page.getByTestId("coord-spawn-plan-slug");
    await expect(planInput).toBeVisible();
    await expect(planInput).toHaveValue(
      "2026-05-19-coordinator-production-readiness"
    );
  });

  test("modal submit posts to /agents/spawn and surfaces coord response", async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;

    await page.route("**/api/v1/operations/plans*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plans: [
            {
              slug: "2026-05-19-coordinator-production-readiness",
              status: "in_progress",
              current_phase: "Phase 4",
              title: "Coord production readiness",
            },
          ],
          count: 1,
        }),
      });
    });
    await page.route("**/api/v1/operations/fleet/health", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          devices: [
            {
              device_id: "00000000-0000-0000-0000-deadbeefcafe",
              hostname: "test-host",
              status: "healthy",
            },
          ],
        }),
      });
    });
    await page.route("**/api/v1/operations/agents/spawn", async (route) => {
      const req = route.request();
      const post = req.postData();
      if (post) {
        try {
          capturedBody = JSON.parse(post);
        } catch {
          capturedBody = null;
        }
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agent_id: "agent-deadbeef",
          agent_session_id: "00000000-0000-0000-0000-000000000abc",
          status: "spawned",
        }),
      });
    });

    await page.goto(SPAWN_PATH);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hasCoordHeading =
      (await page
        .getByRole("heading", { name: "Coord operator console", exact: true })
        .count()) > 0;
    if (!hasCoordHeading) return;

    await page.getByTestId("coord-spawn-row-button").first().click();
    await expect(page.getByTestId("coord-spawn-modal")).toBeVisible();

    // Fill all required fields. Phase is pre-seeded; device requires a
    // dropdown selection; repos requires at least one checkbox; intent
    // + initial-prompt are free-text.
    await page.getByTestId("coord-spawn-device-select").click();
    await page
      .getByRole("option", { name: /test-host/ })
      .click();

    await page.getByTestId("coord-spawn-repo-qontinui-web").click();
    await page.getByTestId("coord-spawn-intent").fill("test spawn from e2e");
    await page
      .getByTestId("coord-spawn-initial-prompt")
      .fill("You are the e2e test agent. Confirm you received this prompt.");

    await page.getByTestId("coord-spawn-submit").click();

    // The modal closes on success.
    await expect(page.getByTestId("coord-spawn-modal")).toBeHidden({
      timeout: 5000,
    });

    // Confirm the body coord received.
    expect(capturedBody).not.toBeNull();
    expect(capturedBody?.plan_slug).toBe(
      "2026-05-19-coordinator-production-readiness"
    );
    expect(capturedBody?.device_id).toBe(
      "00000000-0000-0000-0000-deadbeefcafe"
    );
    expect(capturedBody?.repos).toEqual(["qontinui-web"]);
    expect(capturedBody?.intent).toBe("test spawn from e2e");
  });
});
