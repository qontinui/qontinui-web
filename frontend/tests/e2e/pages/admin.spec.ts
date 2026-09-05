/**
 * End-to-end tests for Admin pages
 *
 * Pages tested:
 * - /admin/architecture - System architecture diagram display
 * - /admin/datasets - Dataset grid with statistics cards
 * - /admin/datasets/[id] - Dataset detail (test with non-existent ID)
 * - /admin/region-analysis - Three-tab interface (Run, Results, History)
 *
 * The /admin (root) and /admin/mobile routes were removed; the dashboard
 * landing was folded into the sub-pages and there is no mobile-specific
 * variant anymore.
 *
 * No fixed sleeps. Every wait here is an auto-waiting assertion on the state
 * the test then checks, or a bounded `waitFor(...).catch(() => null)` in
 * front of a conditional the test already tolerated (the superuser-gated
 * pages redirect non-admins, and that branch stays tolerated) — never a
 * `waitForTimeout(N)` followed by a non-waiting `count()` read, which asserts
 * on wall-clock. Timeouts are the replaced sleep × 3, floor 5 s.
 * Plan: 2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time.
 */

import { test, expect } from "../fixtures";

/** Replaces the old `waitForTimeout(2000)` before a heading read. */
const HEADING_TIMEOUT = 6000;
/** Replaces the old `waitForTimeout(2500)` before a coord-shell read. */
const COORD_SHELL_TIMEOUT = 7500;
/** Replaces the old `waitForTimeout(3000)` before a page-data read. */
const PAGE_DATA_TIMEOUT = 9000;
/** Replaces the old `waitForTimeout(1500)` on the coord page-load loop. */
const COORD_PAGE_TIMEOUT = 5000;

/** The `<h1>` every /admin/coord/* page renders for a superuser. */
const coordHeading = (page: import("@playwright/test").Page) =>
  page.getByRole("heading", { name: "Coord operator console", exact: true });

test.describe("Admin - Architecture", () => {
  test("should load architecture page without errors", async ({ page }) => {
    await page.goto("/admin/architecture");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/admin-architecture.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display architecture heading or redirect for non-admin", async ({
    page,
  }) => {
    await page.goto("/admin/architecture");
    await page.waitForLoadState("domcontentloaded");

    // The page renders <h1>Architecture</h1> (page.tsx:52); the older
    // "Qontinui Architecture" string lived on the deleted /admin (root)
    // landing. Bounded wait for it, tolerated if absent (non-admin redirect).
    await page
      .getByRole("heading", { name: "Architecture", exact: true })
      .waitFor({ state: "visible", timeout: HEADING_TIMEOUT })
      .catch(() => null);
    const hasArchitectureHeading =
      (await page
        .getByRole("heading", { name: "Architecture", exact: true })
        .count()) > 0;
    const wasRedirected =
      page.url().includes("/build/workflows") ||
      (page.url().includes("/dashboard") && !page.url().includes("/admin"));

    expect(hasArchitectureHeading || wasRedirected).toBeTruthy();
  });

  test("should have navigation back to admin", async ({ page }) => {
    await page.goto("/admin/architecture");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await page
      .getByRole("heading", { name: "Architecture", exact: true })
      .waitFor({ state: "visible", timeout: HEADING_TIMEOUT })
      .catch(() => null);
    const hasArchitectureHeading =
      (await page
        .getByRole("heading", { name: "Architecture", exact: true })
        .count()) > 0;

    if (hasArchitectureHeading) {
      // Header is now a breadcrumb: <Button>Admin</Button> / <h1>Architecture</h1>
      // (page.tsx:44-53). The button has a data-testid so we don't collide
      // with the sidebar's "Admin" parent nav item (rendered for superusers
      // via nav-items.ts:581).
      const adminBreadcrumb = page.getByTestId("admin-architecture-back-btn");
      await expect(adminBreadcrumb).toBeVisible();
    }
  });
});

test.describe("Admin - Datasets", () => {
  test("should load datasets page without errors", async ({ page }) => {
    await page.goto("/admin/datasets");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/admin-datasets.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display datasets heading or access denied", async ({ page }) => {
    await page.goto("/admin/datasets");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading or the access-denied copy, tolerated if
    // neither (non-admin redirect) — the reads below are the original shape.
    await page
      .locator("text=Training Datasets")
      .or(page.locator("text=Admin Access Required"))
      .first()
      .waitFor({ state: "visible", timeout: HEADING_TIMEOUT })
      .catch(() => null);
    const hasDatasetsHeading =
      (await page.locator("text=Training Datasets").count()) > 0;
    const hasAccessRequired =
      (await page.locator("text=Admin Access Required").count()) > 0;
    const wasRedirected =
      page.url().includes("/dashboard") && !page.url().includes("/admin");

    expect(
      hasDatasetsHeading || hasAccessRequired || wasRedirected
    ).toBeTruthy();
  });

  test("should have import button for admin users", async ({ page }) => {
    await page.goto("/admin/datasets");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await page
      .locator("text=Training Datasets")
      .first()
      .waitFor({ state: "visible", timeout: HEADING_TIMEOUT })
      .catch(() => null);
    const hasDatasetsHeading =
      (await page.locator("text=Training Datasets").count()) > 0;

    if (hasDatasetsHeading) {
      // Import button should be visible (either in header or empty state)
      await expect(
        page
          .locator("text=Import Dataset")
          .or(page.locator("text=Import Your First Dataset"))
          .first()
      ).toBeVisible({ timeout: HEADING_TIMEOUT });
    }
  });

  test("should show dataset grid or empty state for admin users", async ({
    page,
  }) => {
    await page.goto("/admin/datasets");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await page
      .locator("text=Training Datasets")
      .first()
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);
    const hasDatasetsHeading =
      (await page.locator("text=Training Datasets").count()) > 0;

    if (hasDatasetsHeading) {
      // Either a grid of datasets with statistics (Images, Annotations, Reviewed)
      // or the empty state message. Tolerance preserved: any of the four.
      await expect(
        page
          .locator("text=No datasets yet")
          .or(page.locator("text=Images"))
          .or(page.locator("text=Review Progress"))
          .or(page.locator("text=Loading datasets"))
          .first()
      ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
    }
  });
});

test.describe("Admin - Dataset Detail (non-existent)", () => {
  test("should handle non-existent dataset ID gracefully", async ({ page }) => {
    await page.goto("/admin/datasets/non-existent-id-12345");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for any of the rendered outcomes, tolerated if none (the
    // redirect branch is a URL read below) — the reads keep their shape.
    await page
      .locator("text=Dataset Not Found")
      .or(page.locator("text=Back to Datasets"))
      .or(page.locator("text=Loading"))
      .first()
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);

    await page.screenshot({
      path: "test-results/admin-dataset-detail-404.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Should show "Dataset Not Found" or "Back to Datasets" or redirect
    const hasNotFound =
      (await page.locator("text=Dataset Not Found").count()) > 0;
    const hasBackButton =
      (await page.locator("text=Back to Datasets").count()) > 0;
    const wasRedirected =
      page.url().includes("/dashboard") && !page.url().includes("/admin");
    const hasLoading = (await page.locator("text=Loading").count()) > 0;

    expect(
      hasNotFound || hasBackButton || wasRedirected || hasLoading
    ).toBeTruthy();
  });
});

test.describe("Admin - Agent Claims", () => {
  // Plan `2026-05-18-agent-spawn-coordination.md` Phase 5. The page
  // backs the `/admin/agent-claims` route and renders four sections —
  // active claims, recent conflicts, recent steals, stale-claim alerts.
  // Smoke-only: superuser-gated like other admin pages, so non-admin
  // users redirect away.

  test("should load agent-claims page without errors", async ({ page }) => {
    await page.goto("/admin/agent-claims");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/admin-agent-claims.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should render heading or redirect non-admin", async ({ page }) => {
    await page.goto("/admin/agent-claims");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await page
      .getByRole("heading", { name: "Agent claims", exact: true })
      .waitFor({ state: "visible", timeout: HEADING_TIMEOUT })
      .catch(() => null);
    const hasAgentClaimsHeading =
      (await page
        .getByRole("heading", { name: "Agent claims", exact: true })
        .count()) > 0;
    const wasRedirected =
      page.url().includes("/build/workflows") ||
      (page.url().includes("/dashboard") && !page.url().includes("/admin"));

    expect(hasAgentClaimsHeading || wasRedirected).toBeTruthy();
  });

  test("should render four dashboard sections for superusers", async ({
    page,
  }) => {
    await page.goto("/admin/agent-claims");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await page
      .getByRole("heading", { name: "Agent claims", exact: true })
      .waitFor({ state: "visible", timeout: COORD_SHELL_TIMEOUT })
      .catch(() => null);
    const hasAgentClaimsHeading =
      (await page
        .getByRole("heading", { name: "Agent claims", exact: true })
        .count()) > 0;

    if (hasAgentClaimsHeading) {
      // The dashboard wrapper exists.
      await expect(
        page.getByTestId("agent-claims-dashboard")
      ).toBeVisible();

      // All four section cards render — they don't depend on coord
      // data being present (each shows an empty-state message when
      // the proxy returns no data).
      await expect(
        page.getByTestId("claims-active-section")
      ).toBeVisible();
      await expect(
        page.getByTestId("claims-conflicts-section")
      ).toBeVisible();
      await expect(
        page.getByTestId("claims-steals-section")
      ).toBeVisible();
      await expect(
        page.getByTestId("claims-alerts-section")
      ).toBeVisible();
    }
  });

  test("should have navigation back to admin", async ({ page }) => {
    await page.goto("/admin/agent-claims");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await page
      .getByRole("heading", { name: "Agent claims", exact: true })
      .waitFor({ state: "visible", timeout: HEADING_TIMEOUT })
      .catch(() => null);
    const hasAgentClaimsHeading =
      (await page
        .getByRole("heading", { name: "Agent claims", exact: true })
        .count()) > 0;

    if (hasAgentClaimsHeading) {
      const adminBreadcrumb = page.getByTestId("admin-agent-claims-back-btn");
      await expect(adminBreadcrumb).toBeVisible();
    }
  });
});

test.describe("Admin - Coord operator console", () => {
  // Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2).
  // The `/admin/coord/*` shell hosts five pages (Fleet / Trees / Plans /
  // Alerts / History) plus cross-links to /admin/agent-claims +
  // /sessions. Smoke-only: superuser-gated like other admin
  // surfaces, so non-admin users redirect away.

  test("should load /admin/coord (landing) without errors", async ({ page }) => {
    await page.goto("/admin/coord");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/admin-coord-landing.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should render coord nav shell with five primary tabs", async ({
    page,
  }) => {
    // The landing page redirects to /admin/coord/pipeline (renamed from
    // /admin/coord/fleet by 2026-08-25-…-devops-sections Phase 4; the old
    // path 308s here). After redirect, both layout + nav render, and the
    // user (if superuser) can see the 5 primary tabs + cross-links.
    await page.goto("/admin/coord/pipeline");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await coordHeading(page)
      .waitFor({ state: "visible", timeout: COORD_SHELL_TIMEOUT })
      .catch(() => null);
    const hasCoordHeading =
      (await page
        .getByRole("heading", { name: "Coord operator console", exact: true })
        .count()) > 0;
    const wasRedirected =
      page.url().includes("/build/workflows") ||
      (page.url().includes("/dashboard") && !page.url().includes("/admin"));

    expect(hasCoordHeading || wasRedirected).toBeTruthy();

    if (hasCoordHeading) {
      await expect(page.getByTestId("coord-nav")).toBeVisible();
      // Nav redesign: four direct tabs + persona dropdown groups. Direct
      // tabs render always; grouped pages surface once their menu opens.
      await expect(page.getByTestId("coord-nav-pipeline")).toBeVisible();
      await expect(page.getByTestId("coord-nav-prs")).toBeVisible();
      await expect(page.getByTestId("coord-nav-gates")).toBeVisible();
      await expect(page.getByTestId("coord-nav-alerts")).toBeVisible();

      // Work group: Plans / Questions / Agents / History / Lands.
      await page.getByTestId("coord-nav-group-work").click();
      await expect(page.getByTestId("coord-nav-plans")).toBeVisible();
      await expect(page.getByTestId("coord-nav-questions")).toBeVisible();
      await expect(page.getByTestId("coord-nav-agents")).toBeVisible();
      await expect(page.getByTestId("coord-nav-history")).toBeVisible();
      await page.keyboard.press("Escape");

      // The Dev Ops group's members are operator-only (this test path runs
      // as superuser when the heading rendered); the group trigger itself is
      // member-visible and carries `Overview`.
      await page.getByTestId("coord-nav-group-devops").click();
      await expect(page.getByTestId("coord-nav-trees")).toBeVisible();
      await page.keyboard.press("Escape");

      // Cross-links to existing surfaces live in the Access group.
      await page.getByTestId("coord-nav-group-access").click();
      await expect(page.getByTestId("coord-nav-claims")).toBeVisible();
      await expect(page.getByTestId("coord-nav-sessions")).toBeVisible();
      await page.keyboard.press("Escape");
    }
  });

  for (const { path, testId } of [
    { path: "/admin/coord/pipeline", testId: "coord-pipeline-page" },
    { path: "/admin/coord/trees", testId: "coord-trees-page" },
    { path: "/admin/coord/plans", testId: "coord-plans-page" },
    { path: "/admin/coord/questions", testId: "coord-questions-page" },
    { path: "/admin/coord/agents", testId: "coord-agents-page" },
    { path: "/admin/coord/alerts", testId: "coord-alerts-page" },
    { path: "/admin/coord/history", testId: "coord-history-page" },
  ]) {
    test(`should load ${path} without errors`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the heading, tolerated if absent (non-admin
      // redirect) — the branch below is the test's original shape.
      await coordHeading(page)
        .waitFor({ state: "visible", timeout: COORD_PAGE_TIMEOUT })
        .catch(() => null);

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");

      const hasCoordHeading =
        (await page
          .getByRole("heading", { name: "Coord operator console", exact: true })
          .count()) > 0;
      const wasRedirected =
        page.url().includes("/build/workflows") ||
        (page.url().includes("/dashboard") && !page.url().includes("/admin"));

      if (hasCoordHeading) {
        // For superusers the inner page-testid container must render.
        await expect(page.getByTestId(testId)).toBeVisible();
      } else {
        // Non-superusers redirect; either path is acceptable here.
        expect(hasCoordHeading || wasRedirected).toBeTruthy();
      }
    });
  }

  test("nav link click navigates between coord pages", async ({ page }) => {
    await page.goto("/admin/coord/pipeline");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await coordHeading(page)
      .waitFor({ state: "visible", timeout: HEADING_TIMEOUT })
      .catch(() => null);
    const hasCoordHeading =
      (await page
        .getByRole("heading", { name: "Coord operator console", exact: true })
        .count()) > 0;
    if (!hasCoordHeading) {
      // Non-superuser path; redirect already verified above.
      return;
    }

    // Plans lives in the Work group — open the menu, then navigate.
    await page.getByTestId("coord-nav-group-work").click();
    await page.getByTestId("coord-nav-plans").click();
    await page.waitForURL(/\/admin\/coord\/plans/);
    await expect(page.getByTestId("coord-plans-page")).toBeVisible();
  });
});

test.describe("Admin - Coord agents (logs)", () => {
  // Plan `2026-05-19-coordinator-production-readiness.md` Phase 5 (Wave 3b).
  // The `/admin/coord/agents` page is the fleet-wide recent agent_logs
  // timeline; `/admin/coord/agents/[agent_id]` is the per-agent live view
  // with filters + session cross-link. Both tests route the coord proxy
  // through Playwright so the page renders deterministic mixed-level
  // rows regardless of whether real coord state is present.

  test("recent activity loads + renders mixed-level rows", async ({
    page,
  }) => {
    const occurredAt = (deltaSec: number) =>
      new Date(Date.now() - deltaSec * 1000).toISOString();
    const mockedLogs = {
      logs: [
        {
          log_id: "fake-1",
          agent_id: "agent-trace-mock-1",
          level: "info",
          event: "agent_boot",
          payload: { build: "fake" },
          occurred_at: occurredAt(5),
        },
        {
          log_id: "fake-2",
          agent_id: "agent-trace-mock-2",
          level: "warn",
          event: "claim_contended",
          payload: { kind: "branch", resource: "wip/foo" },
          occurred_at: occurredAt(20),
        },
        {
          log_id: "fake-3",
          agent_id: "agent-trace-mock-1",
          level: "error",
          event: "claim_failed",
          payload: { code: "E_BUSY" },
          occurred_at: occurredAt(40),
        },
      ],
    };

    await page.route("**/api/v1/operations/agent-logs/recent**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockedLogs),
      }),
    );

    await page.goto("/admin/coord/agents");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await coordHeading(page)
      .waitFor({ state: "visible", timeout: COORD_SHELL_TIMEOUT })
      .catch(() => null);

    const hasCoordHeading =
      (await page
        .getByRole("heading", { name: "Coord operator console", exact: true })
        .count()) > 0;
    if (!hasCoordHeading) {
      // Non-superuser identity (test fixture redirects); the redirect
      // is already verified by the broader admin coord smoke tests.
      return;
    }

    await expect(page.getByTestId("coord-agents-page")).toBeVisible();
    await expect(page.getByTestId("coord-agents-recent-list")).toBeVisible();

    const rows = page.getByTestId("agent-log-row");
    await expect(rows).toHaveCount(3);

    // Mixed levels rendered.
    await expect(page.getByTestId("log-level-info").first()).toBeVisible();
    await expect(page.getByTestId("log-level-warn").first()).toBeVisible();
    await expect(page.getByTestId("log-level-error").first()).toBeVisible();
  });

  test("per-agent page filters correctly + shows session cross-link", async ({
    page,
  }) => {
    const occurredAt = (deltaSec: number) =>
      new Date(Date.now() - deltaSec * 1000).toISOString();
    const agentId = "agent-fake-session-test";
    const sessionId = "session-fake-uuid-1234";
    const mockedLogs = {
      agent_id: agentId,
      logs: [
        {
          log_id: "p-1",
          agent_id: agentId,
          agent_session_id: sessionId,
          level: "info",
          event: "boot",
          payload: { ok: true },
          occurred_at: occurredAt(2),
        },
        {
          log_id: "p-2",
          agent_id: agentId,
          agent_session_id: sessionId,
          level: "warn",
          event: "slow_query",
          payload: { ms: 4500 },
          occurred_at: occurredAt(10),
        },
        {
          log_id: "p-3",
          agent_id: agentId,
          agent_session_id: sessionId,
          level: "info",
          event: "phase_complete",
          payload: { phase: "build" },
          occurred_at: occurredAt(30),
        },
      ],
    };

    await page.route(
      `**/api/v1/operations/agent-logs/by-agent/${agentId}**`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockedLogs),
        }),
    );

    await page.goto(`/admin/coord/agents/${agentId}`);
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await coordHeading(page)
      .waitFor({ state: "visible", timeout: COORD_SHELL_TIMEOUT })
      .catch(() => null);

    const hasCoordHeading =
      (await page
        .getByRole("heading", { name: "Coord operator console", exact: true })
        .count()) > 0;
    if (!hasCoordHeading) {
      return;
    }

    await expect(page.getByTestId("coord-agent-log-page")).toBeVisible();
    await expect(page.getByTestId("coord-agent-log-list")).toBeVisible();

    // All three rows render initially (no filter).
    const rows = page.getByTestId("agent-log-row");
    await expect(rows).toHaveCount(3);

    // Toggle warn-only filter → 1 row remains.
    await page.getByTestId("coord-agent-log-level-warn").click();
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId("log-level-warn")).toBeVisible();

    // Clear warn, toggle info → 2 rows.
    await page.getByTestId("coord-agent-log-level-warn").click();
    await page.getByTestId("coord-agent-log-level-info").click();
    await expect(rows).toHaveCount(2);

    // Clear filter, then event-contains "phase" → 1 row.
    await page.getByTestId("coord-agent-log-level-info").click();
    await page.getByTestId("coord-agent-log-event-filter").fill("phase");
    await expect(rows).toHaveCount(1);

    // Session cross-link surfaces because rows carry agent_session_id.
    const sessionLink = page.getByTestId("coord-agent-log-session-link");
    await expect(sessionLink).toBeVisible();
    await expect(sessionLink).toHaveAttribute(
      "href",
      `/sessions/${sessionId}`,
    );
  });
});

test.describe("Admin - Coord memory browser (Wave 3c)", () => {
  // Plan `2026-05-19-coordinator-production-readiness.md` Phase 6.
  //
  // Memory browser lives at /admin/coord/memory and exercises three
  // mock-driven journeys: list-with-filter, detail-renders-markdown +
  // version-dropdown, and restore-workflow. All API traffic is
  // intercepted via page.route() so the tests don't require coord +
  // backend to be live.

  const MEMORY_LIST_PAYLOAD = {
    entries: [
      {
        name: "proj_alpha",
        type: "project",
        version: 3,
        description: "Project Alpha — the canonical example.",
        written_at: "2026-05-20T00:00:00Z",
        written_by_agent: "agent-a",
      },
      {
        name: "feedback_beta",
        type: "feedback",
        version: 1,
        description: "Beta feedback memo.",
        written_at: "2026-05-18T00:00:00Z",
        written_by_agent: "agent-b",
      },
    ],
    count: 2,
  };

  const MEMORY_DETAIL_PAYLOAD = {
    name: "proj_alpha",
    type: "project",
    version: 3,
    content: "# Project Alpha\n\nCanonical example with **markdown** body.",
    description: "Project Alpha — the canonical example.",
    written_at: "2026-05-20T00:00:00Z",
    written_by_agent: "agent-a",
    written_by_device: "dev-a",
    history: [
      { version: 3, written_at: "2026-05-20T00:00:00Z" },
      { version: 2, written_at: "2026-05-19T00:00:00Z" },
      { version: 1, written_at: "2026-05-18T00:00:00Z" },
    ],
  };

  const MEMORY_VERSION_PAYLOAD = {
    name: "proj_alpha",
    version: 2,
    content: "# Project Alpha (v2)\n\nThe historical body.",
    type: "project",
    written_at: "2026-05-19T00:00:00Z",
    written_by_agent: "agent-a",
  };

  test("memory list loads + filters by name prefix", async ({ page }) => {
    await page.route("**/api/v1/operations/memory/list", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MEMORY_LIST_PAYLOAD),
      });
    });

    await page.goto("/admin/coord/memory");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await coordHeading(page)
      .waitFor({ state: "visible", timeout: HEADING_TIMEOUT })
      .catch(() => null);

    const hasCoordHeading =
      (await page
        .getByRole("heading", { name: "Coord operator console", exact: true })
        .count()) > 0;
    if (!hasCoordHeading) {
      // Non-superuser path; nothing more to assert here. The shell tests
      // above already verified the redirect.
      return;
    }

    await expect(page.getByTestId("coord-memory-page")).toBeVisible();
    // Memory lives in the Dev Ops group; the active page surfaces as the
    // group trigger's wayfinding crumb.
    await expect(page.getByTestId("coord-nav-memory-active")).toBeVisible();

    // Both rows render initially.
    const cards = page.getByTestId("coord-memory-card");
    await expect(cards).toHaveCount(2);

    // Name-prefix filter narrows to one row.
    await page.getByTestId("coord-memory-name-prefix").fill("proj_");
    await expect(page.getByTestId("coord-memory-card")).toHaveCount(1);
    await expect(
      page.getByTestId("coord-memory-card-name")
    ).toContainText("proj_alpha");
  });

  test("memory detail renders markdown + version dropdown", async ({
    page,
  }) => {
    await page.route(
      "**/api/v1/operations/memory/proj_alpha",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MEMORY_DETAIL_PAYLOAD),
        });
      }
    );

    await page.goto("/admin/coord/memory/proj_alpha");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await coordHeading(page)
      .waitFor({ state: "visible", timeout: HEADING_TIMEOUT })
      .catch(() => null);

    const hasCoordHeading =
      (await page
        .getByRole("heading", { name: "Coord operator console", exact: true })
        .count()) > 0;
    if (!hasCoordHeading) {
      return;
    }

    await expect(page.getByTestId("coord-memory-detail-page")).toBeVisible();
    // Markdown content rendered (heading + bold) into the rendered area.
    const rendered = page.getByTestId("coord-memory-rendered");
    await expect(rendered).toBeVisible();
    await expect(rendered).toContainText("Project Alpha");
    await expect(rendered.locator("h1")).toBeVisible();

    // Frontmatter sidebar visible.
    await expect(page.getByTestId("coord-memory-frontmatter")).toBeVisible();

    // Version dropdown renders (3 history entries).
    await expect(page.getByTestId("coord-memory-history")).toBeVisible();
    await expect(
      page.getByTestId("coord-memory-version-select")
    ).toBeVisible();
  });

  test("restore workflow round-trip (mock the API)", async ({ page }) => {
    let restoreCalled = false;
    let restoreBody: unknown = null;

    await page.route(
      "**/api/v1/operations/memory/proj_alpha/version/2",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MEMORY_VERSION_PAYLOAD),
        });
      }
    );
    await page.route(
      "**/api/v1/operations/memory/proj_alpha/restore",
      async (route) => {
        restoreCalled = true;
        try {
          restoreBody = JSON.parse(route.request().postData() ?? "{}");
        } catch {
          restoreBody = null;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            name: "proj_alpha",
            restored_from_version: 2,
            new_head_version: 4,
          }),
        });
      }
    );
    // Detail-page redirect target after the restore action.
    await page.route(
      "**/api/v1/operations/memory/proj_alpha",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MEMORY_DETAIL_PAYLOAD),
        });
      }
    );

    await page.goto("/admin/coord/memory/proj_alpha/version/2");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await coordHeading(page)
      .waitFor({ state: "visible", timeout: HEADING_TIMEOUT })
      .catch(() => null);

    const hasCoordHeading =
      (await page
        .getByRole("heading", { name: "Coord operator console", exact: true })
        .count()) > 0;
    if (!hasCoordHeading) {
      return;
    }

    await expect(page.getByTestId("coord-memory-version-page")).toBeVisible();
    await expect(
      page.getByTestId("coord-memory-version-content")
    ).toContainText("Project Alpha (v2)");

    // Open confirm dialog + confirm.
    await page.getByTestId("coord-memory-restore-btn").click();
    await expect(
      page.getByTestId("coord-memory-restore-dialog")
    ).toBeVisible();
    await page.getByTestId("coord-memory-restore-confirm").click();

    // Wait for the POST to fire + the redirect back to the detail page.
    await page.waitForURL(/\/admin\/coord\/memory\/proj_alpha$/);
    expect(restoreCalled).toBeTruthy();
    expect(restoreBody).toEqual({ version: 2 });
  });
});

test.describe("Admin - Region Analysis", () => {
  test("should load region analysis page without errors", async ({ page }) => {
    await page.goto("/admin/region-analysis");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/admin-region-analysis.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Region Analysis heading or redirect", async ({
    page,
  }) => {
    await page.goto("/admin/region-analysis");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await page
      .locator("text=Region Analysis")
      .first()
      .waitFor({ state: "visible", timeout: HEADING_TIMEOUT })
      .catch(() => null);
    const hasRegionHeading =
      (await page.locator("text=Region Analysis").count()) > 0;
    const wasRedirected =
      page.url().includes("/dashboard") && !page.url().includes("/admin");

    expect(hasRegionHeading || wasRedirected).toBeTruthy();
  });

  test("should have three-tab interface (Run, Results, History)", async ({
    page,
  }) => {
    await page.goto("/admin/region-analysis");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (non-admin redirect).
    await page
      .locator("text=Region Analysis")
      .first()
      .waitFor({ state: "visible", timeout: HEADING_TIMEOUT })
      .catch(() => null);
    const hasRegionHeading =
      (await page.locator("text=Region Analysis").count()) > 0;

    if (hasRegionHeading) {
      // The tabs are only visible when an annotation set is selected.
      // Check for either the tab interface or the annotation set selector.
      // Original shape: (Run && Results && History) || selector || noSets.
      const noSetSelected = page
        .locator("text=Select Annotation Set")
        .or(page.locator("text=No annotation sets found"));
      await expect(
        page
          .locator('button:has-text("Run Analysis")')
          .or(noSetSelected)
          .first()
      ).toBeVisible({ timeout: HEADING_TIMEOUT });

      if ((await noSetSelected.count()) === 0) {
        await expect(
          page.locator('button:has-text("Results")').first()
        ).toBeVisible({ timeout: HEADING_TIMEOUT });
        await expect(
          page.locator('button:has-text("History")').first()
        ).toBeVisible({ timeout: HEADING_TIMEOUT });
      }
    }
  });
});
