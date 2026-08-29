/**
 * CoordNav — grouped console navigation.
 *
 * Contracts under test (nav redesign):
 *  - five direct tabs; everything else inside persona dropdown groups
 *  - operator gating: operator-only items (Merge Settings, and every `Dev Ops`
 *    member except `Overview`) never render for a plain member. The GROUP
 *    flag and the ITEM flag are independent: `Dev Ops ▾` opens for a member
 *    carrying exactly one entry, which is the regression test for the
 *    resolved Q3 of
 *    `2026-08-25-coord-console-intent-and-devops-sections`
 *  - `Intent ▾` holds the prompt-document cluster (Prompt Documents /
 *    Policies / Policy Edit Review), member-visible trigger and items alike,
 *    and `Merge ▾` no longer does — while `Gate Clearance` stays in `Merge`,
 *    because a gate is merge-chain machinery (Phase 3 / resolved Q2 of
 *    `2026-08-25-coord-console-intent-and-devops-sections`)
 *  - wayfinding crumb: the group trigger of the active page highlights and
 *    exposes `<testid>-active` — asserted for every leaf that changed groups,
 *    since the testids are unchanged and Spec-CI keys on them
 *  - live Alerts badge from the unresolved-alerts rollup
 *  - live Notifications badge from the server's `unread_count` SCALAR —
 *    never the returned page length (plan
 *    `2026-08-05-coord-notifications-type-and-tab.md`, Change 4)
 *  - the FLEET ALARM on the `Dev Ops ▾` trigger (Verification 7 of
 *    `2026-08-25-coord-console-intent-and-devops-sections`), including the
 *    `unknown` count, which is the one that must survive: a trigger that
 *    showed only breaches would render a fleet whose telemetry has gone dark
 *    exactly like a healthy one
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let pathname = "/admin/coord/pipeline";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

let isSuperuser = false;
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { is_superuser: isSuperuser } }),
}));

const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
  },
}));

import CoordNav from "./CoordNav";

describe("CoordNav", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpGet.mockResolvedValue({ alerts: [], total_count: 0 });
    pathname = "/admin/coord/pipeline";
    isSuperuser = false;
  });

  it("renders five direct tabs and every member group, Dev Ops included", async () => {
    const user = userEvent.setup();
    render(<CoordNav />);

    // The tab has read "Pipeline" since 2026-07-14; Phase 4 of
    // `2026-08-25-coord-console-intent-and-devops-sections` finally made the
    // route and the testid say so too (`coord-nav-fleet` →
    // `coord-nav-pipeline`, `/admin/coord/fleet` → `/admin/coord/pipeline`).
    const pipeline = screen.getByTestId("coord-nav-pipeline");
    expect(pipeline).toHaveTextContent("Pipeline");
    expect(pipeline).toHaveAttribute("href", "/admin/coord/pipeline");
    expect(screen.queryByTestId("coord-nav-fleet")).not.toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-prs")).toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-gates")).toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-alerts")).toBeInTheDocument();
    const notifications = screen.getByTestId("coord-nav-notifications");
    expect(notifications).toHaveTextContent("Notifications");
    expect(notifications).toHaveAttribute("href", "/admin/coord/notifications");

    expect(screen.getByTestId("coord-nav-group-work")).toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-group-merge")).toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-group-intent")).toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-group-access")).toBeInTheDocument();

    // `Infra ▾` is gone, and the group that replaced it is NOT hidden from a
    // member: the group flag moved onto the items (resolved Q3). This test
    // used to assert the opposite — a plain member seeing no infra group at
    // all — which is exactly what the rename changes.
    expect(
      screen.queryByTestId("coord-nav-group-infra")
    ).not.toBeInTheDocument();
    const devops = screen.getByTestId("coord-nav-group-devops");
    expect(devops).toHaveTextContent("Dev Ops");

    // …and it carries EXACTLY one entry for a member.
    await user.click(devops);
    const overview = await screen.findByTestId("coord-nav-devops-overview");
    expect(overview).toBeVisible();
    expect(overview).toHaveAttribute("href", "/admin/coord/devops");
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  });

  it("hides operator-only items inside member-visible groups", async () => {
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-merge"));
    expect(
      await screen.findByTestId("coord-nav-automation-rules")
    ).toBeVisible();
    expect(screen.getByTestId("coord-nav-pull-decisions")).toBeVisible();
    expect(
      screen.queryByTestId("coord-nav-merge-settings")
    ).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // `Intent ▾` — the prompt-document cluster, moved out of `Merge ▾`
  // (`2026-08-25-coord-console-intent-and-devops-sections` Phase 3, Gap 1).
  // None of the three is read by the merge train, gates a PR, or appears in a
  // merge decision; `Gate Clearance` is the one that stayed, because what it
  // authors rows about is who may clear a GATE (resolved Q2).
  // --------------------------------------------------------------------------

  it("shows the Intent group to a plain member with exactly its three entries", async () => {
    const user = userEvent.setup();
    render(<CoordNav />);

    const trigger = screen.getByTestId("coord-nav-group-intent");
    expect(trigger).toHaveTextContent("Intent");

    await user.click(trigger);
    const promptDocuments = await screen.findByTestId(
      "coord-nav-prompt-documents"
    );
    expect(promptDocuments).toBeVisible();
    expect(promptDocuments).toHaveAttribute(
      "href",
      "/admin/coord/prompt-documents"
    );
    expect(screen.getByTestId("coord-nav-policies")).toHaveAttribute(
      "href",
      "/admin/coord/policies"
    );
    expect(
      screen.getByTestId("coord-nav-prompt-document-proposals")
    ).toHaveAttribute("href", "/admin/coord/prompt-document-proposals");

    // Exactly three — nothing else drifted in, and none of them is
    // operator-gated, so the member sees the whole group.
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("sits Intent between Merge and Dev Ops", () => {
    render(<CoordNav />);

    const triggers = Array.from(
      screen
        .getByTestId("coord-nav")
        .querySelectorAll("[data-testid^='coord-nav-group-']")
    ).map((el) => el.getAttribute("data-testid"));
    expect(triggers).toEqual([
      "coord-nav-group-work",
      "coord-nav-group-merge",
      "coord-nav-group-intent",
      "coord-nav-group-devops",
      "coord-nav-group-access",
    ]);
  });

  it("leaves Merge with the merge chain only — the three moved out, Gate Clearance stayed", async () => {
    isSuperuser = true;
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-merge"));
    await screen.findByTestId("coord-nav-pull-decisions");

    const menu = screen.getByRole("menu");
    for (const moved of [
      "coord-nav-prompt-documents",
      "coord-nav-policies",
      "coord-nav-prompt-document-proposals",
    ]) {
      expect(within(menu).queryByTestId(moved)).not.toBeInTheDocument();
    }
    expect(within(menu).getByTestId("coord-nav-gate-clearance")).toBeVisible();

    // Pull Decisions · Automation Rules · Gate Clearance · Merge Settings°.
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
  });

  it("keeps the wayfinding crumb contract for every moved Intent leaf", () => {
    // Same nav-level contract as the Dev Ops sweep below: the crumb has to
    // hold with the dropdown CLOSED, because the menu items unmount and
    // Spec-CI's "active section" selectors match `coord-nav-<x>-active` on
    // the group trigger. Every leaf that changed groups is asserted here.
    for (const [path, testId, label] of [
      [
        "/admin/coord/prompt-documents",
        "coord-nav-prompt-documents",
        "Prompt Documents",
      ],
      ["/admin/coord/policies", "coord-nav-policies", "Policies"],
      [
        "/admin/coord/prompt-document-proposals",
        "coord-nav-prompt-document-proposals",
        "Policy Edit Review",
      ],
    ] as const) {
      pathname = path;
      const view = render(<CoordNav />);
      const trigger = within(view.container).getByTestId(
        "coord-nav-group-intent"
      );
      const crumb = within(view.container).getByTestId(`${testId}-active`);
      expect(crumb).toHaveTextContent(label);
      expect(trigger).toContainElement(crumb);
      // …and the group they left does not claim them.
      expect(
        within(view.container).getByTestId("coord-nav-group-merge")
      ).toHaveTextContent(/^Merge$/);
      view.unmount();
    }
  });

  it("offers Gate Clearance in the Merge group and links it", async () => {
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-merge"));
    const item = await screen.findByTestId("coord-nav-gate-clearance");
    expect(item).toBeVisible();
    expect(item).toHaveAttribute("href", "/admin/coord/gate-clearance");
  });

  it("shows the Dev Ops group with all its items for operators", async () => {
    isSuperuser = true;
    const user = userEvent.setup();
    render(<CoordNav />);

    const trigger = screen.getByTestId("coord-nav-group-devops");
    await user.click(trigger);
    expect(
      await screen.findByTestId("coord-nav-devops-overview")
    ).toBeVisible();
    expect(screen.getByTestId("coord-nav-trees")).toBeVisible();
    expect(screen.getByTestId("coord-nav-git-ops")).toBeVisible();
    expect(screen.getByTestId("coord-nav-onboarding-status")).toBeVisible();
    // Runner releases dashboard lives beside Deploys in the Dev Ops group.
    expect(screen.getByTestId("coord-nav-releases")).toBeVisible();
    // The two routes Phase 4 created out of panels that were buried two
    // disclosures deep inside the pipeline page.
    expect(screen.getByTestId("coord-nav-test-targets")).toHaveAttribute(
      "href",
      "/admin/coord/test-targets"
    );
    expect(screen.getByTestId("coord-nav-migrations")).toHaveAttribute(
      "href",
      "/admin/coord/migrations"
    );
    // Overview, then the eleven operator-only members.
    expect(screen.getAllByRole("menuitem")).toHaveLength(12);
  });

  it("orders the Dev Ops group Overview · Trees · Spawn · Test Targets · Migrations", async () => {
    isSuperuser = true;
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-devops"));
    await screen.findByTestId("coord-nav-devops-overview");
    const items = screen.getAllByRole("menuitem");
    expect(items.slice(0, 5).map((el) => el.textContent)).toEqual([
      "Overview",
      "Trees",
      "Spawn",
      "Test Targets",
      "Migrations",
    ]);
  });

  it("hides the Releases Dev Ops tab from a plain member", () => {
    // Unchanged in meaning by the rename: `Releases` keeps `operatorOnly`.
    // Paired with the member seeing `Dev Ops ▾` above, this IS the Q3
    // regression test — the group opens, the cross-tenant members do not.
    render(<CoordNav />);
    expect(screen.queryByTestId("coord-nav-releases")).not.toBeInTheDocument();
  });

  it("keeps the wayfinding crumb contract for every moved Dev Ops leaf", () => {
    // The crumb is a nav-level contract, not a menu-open one: every assertion
    // below holds with the dropdown closed, which is the point — Spec-CI's
    // "active section" selectors match `coord-nav-<x>-active` on the trigger.
    isSuperuser = true;
    for (const [path, testId, label] of [
      ["/admin/coord/devops", "coord-nav-devops-overview", "Overview"],
      ["/admin/coord/trees", "coord-nav-trees", "Trees"],
      ["/admin/coord/test-targets", "coord-nav-test-targets", "Test Targets"],
      ["/admin/coord/migrations", "coord-nav-migrations", "Migrations"],
      ["/admin/coord/releases", "coord-nav-releases", "Releases"],
      ["/admin/coord/git-ops", "coord-nav-git-ops", "Git Ops"],
      ["/admin/coord/memory", "coord-nav-memory", "Memory"],
      [
        "/admin/coord/onboarding-status",
        "coord-nav-onboarding-status",
        "Onboarding Status",
      ],
    ] as const) {
      pathname = path;
      const view = render(<CoordNav />);
      const trigger = within(view.container).getByTestId(
        "coord-nav-group-devops"
      );
      const crumb = within(view.container).getByTestId(`${testId}-active`);
      expect(crumb).toHaveTextContent(label);
      expect(trigger).toContainElement(crumb);
      view.unmount();
    }
  });

  it("surfaces the active page as a crumb on its group trigger", () => {
    pathname = "/admin/coord/lands";
    render(<CoordNav />);

    const trigger = screen.getByTestId("coord-nav-group-work");
    expect(trigger).toHaveTextContent("Work");
    const crumb = screen.getByTestId("coord-nav-lands-active");
    expect(crumb).toHaveTextContent("Lands");
    expect(trigger).toContainElement(crumb);
    // Sibling groups stay idle — no crumb.
    expect(screen.getByTestId("coord-nav-group-merge")).toHaveTextContent(
      /^Merge$/
    );
  });

  it("cross-links live in the Access group with external hrefs", async () => {
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-access"));
    const claims = await screen.findByTestId("coord-nav-claims");
    expect(claims).toHaveAttribute("href", "/admin/agent-claims");
    expect(screen.getByTestId("coord-nav-sessions")).toHaveAttribute(
      "href",
      "/sessions"
    );
    expect(screen.getByTestId("coord-nav-members")).toHaveAttribute(
      "href",
      "/admin/coord/members"
    );
  });

  // --------------------------------------------------------------------------
  // The alerts badge is a COUNT, not the length of a truncated sample.
  //
  // Measured 2026-08-14 (plan
  // `2026-08-05-coord-alerts-surface-and-fleet-style-ui.md`, § MEASURED): the
  // badge read a constant 500 against 1643 unresolved rows because it counted
  // the rows in coord's hard-capped window, and `critical` was unconditionally
  // true because that window happened to be 100% critical. These are the
  // fix's regression tests, not a guard against one.
  // --------------------------------------------------------------------------

  /** Route the two `limit=1` reads the badge issues. */
  function mockTotals(all: unknown, criticals: unknown) {
    httpGet.mockImplementation((url: unknown) =>
      Promise.resolve(
        String(url).includes("severity=critical") ? criticals : all
      )
    );
  }

  it("reads total_count, not the length of the served window", async () => {
    mockTotals(
      // One row served (limit=1) but 1643 matching — the badge must say 1643.
      { alerts: [{ severity: "critical" }], total_count: 1643 },
      { alerts: [{ severity: "critical" }], total_count: 637 }
    );
    render(<CoordNav />);

    const badge = await screen.findByTestId("coord-nav-alerts-badge");
    expect(badge).toHaveTextContent("1643");
    expect(badge.textContent).not.toContain("≥");
    expect(badge.className).toContain("text-red-200");
    expect(badge).toHaveAttribute("data-total-known", "true");

    // And it asks for ONE row, not the 500 the old code dragged over the wire
    // on every page every poll.
    //
    // Scoped to the ALERTS reads: the sibling Notifications badge polls
    // `/operations/notifications?limit=1` from this same component, and that
    // endpoint has no `include_resolved` axis at all — sweeping every
    // `httpGet` call would fail on a URL this assertion was never about.
    // The explicit count keeps the filter from passing vacuously on an empty
    // list if the badge ever stops issuing the reads.
    const alertsCalls = httpGet.mock.calls.filter((call) =>
      String(call[0]).startsWith("/api/v1/operations/alerts")
    );
    expect(alertsCalls).toHaveLength(2);
    for (const call of alertsCalls) {
      expect(String(call[0])).toContain("limit=1");
      expect(String(call[0])).toContain("include_resolved=false");
    }
  });

  it("takes the critical flag from a severity-filtered total, not the sample", async () => {
    // The window is 100% critical, but ZERO criticals match — the old
    // `alerts.some(...)` read would paint this red.
    mockTotals(
      { alerts: [{ severity: "critical" }], total_count: 42 },
      { alerts: [], total_count: 0 }
    );
    render(<CoordNav />);

    const badge = await screen.findByTestId("coord-nav-alerts-badge");
    expect(badge).toHaveTextContent("42");
    expect(badge.className).not.toContain("text-red-200");
  });

  it("degrades a missing total_count to a ≥ lower bound, never to the truth", async () => {
    // An un-upgraded coord silently drops `limit`/`severity` and answers with
    // the old shape. Its length is a FLOOR — say so rather than presenting a
    // truncated count as the real one.
    const window = {
      alerts: [{ severity: "critical" }, { severity: "warning" }],
    };
    mockTotals(window, window);
    render(<CoordNav />);

    const badge = await screen.findByTestId("coord-nav-alerts-badge");
    expect(badge.textContent).toContain("≥2");
    expect(badge).toHaveAttribute("data-total-known", "false");
    expect(badge.className).toContain("text-red-200");
  });

  it("renders no badge when the rollup is empty or unavailable", async () => {
    httpGet.mockRejectedValue(new Error("boom"));
    render(<CoordNav />);

    await waitFor(() => expect(httpGet).toHaveBeenCalled());
    expect(
      screen.queryByTestId("coord-nav-alerts-badge")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-nav-notifications-badge")
    ).not.toBeInTheDocument();
  });

  describe("polling is gated on tab visibility", () => {
    /**
     * The nav renders on every console page, so these two badges are the
     * widest-reach pollers in the app. `/admin/coord/alerts` gates its own two
     * pollers and `RedMainBanner` gates its one; this nav was the third the
     * alerts page's comment names and the only one still ticking behind a
     * hidden tab.
     *
     * Asserted through `document.visibilityState` rather than through a
     * request count alone, because "no requests fired" is also what a broken
     * poller looks like — the catch-up leg is what tells the two apart.
     */
    function setVisibility(state: "visible" | "hidden") {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => state,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }

    afterEach(() => {
      // Hand the property back, or every later test in the file inherits a
      // hidden document.
      delete (document as unknown as Record<string, unknown>).visibilityState;
    });

    it("skips ticks while the tab is hidden, and catches up when it returns", async () => {
      httpGet.mockResolvedValue({ alerts: [], total_count: 3 });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        // The INITIAL fetch is the caller's job and always runs, so a tab that
        // mounts hidden still has a badge when it is revealed.
        await waitFor(() => expect(httpGet).toHaveBeenCalled());
        const afterMount = httpGet.mock.calls.length;

        setVisibility("hidden");
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(
          httpGet.mock.calls.length,
          "a hidden tab must not bill a request"
        ).toBe(afterMount);

        setVisibility("visible");
        await waitFor(() =>
          expect(httpGet.mock.calls.length).toBeGreaterThan(afterMount)
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("still polls on the interval while the tab is visible", async () => {
      httpGet.mockResolvedValue({ alerts: [], total_count: 3 });
      setVisibility("visible");
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        await waitFor(() => expect(httpGet).toHaveBeenCalled());
        const afterMount = httpGet.mock.calls.length;

        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() =>
          expect(httpGet.mock.calls.length).toBeGreaterThan(afterMount)
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Notifications badge", () => {
    /** Route the two nav polls independently. */
    const routeGet = (notifications: unknown) => {
      httpGet.mockImplementation((url: unknown) => {
        if (String(url).startsWith("/api/v1/operations/notifications")) {
          return notifications instanceof Error
            ? Promise.reject(notifications)
            : Promise.resolve(notifications);
        }
        return Promise.resolve({ alerts: [] });
      });
    };

    it("reads the server's unread_count scalar, not the page length", async () => {
      // The regression this test exists for: the endpoint is PAGED, so the
      // returned row count is the page size. A badge derived from
      // `notifications.length` would read 2 forever; the truth is 137.
      routeGet({
        notifications: [{ notification_id: "a" }, { notification_id: "b" }],
        next_cursor: "opaque",
        total: 900,
        unread_count: 137,
      });
      render(<CoordNav />);

      const badge = await screen.findByTestId("coord-nav-notifications-badge");
      expect(badge).toHaveTextContent("137");
      // Never the returned page length, and never the unfiltered total.
      expect(badge).not.toHaveTextContent(/^2$/);
      expect(badge).not.toHaveTextContent(/^900$/);
      // A count is not a condition — the notifications badge is never red.
      expect(badge.className).not.toContain("text-red-200");
    });

    it("asks for a single row, and opts 503 out of the 5xx retry", async () => {
      routeGet({ notifications: [], total: 0, unread_count: 0 });
      render(<CoordNav />);

      // `?limit=1` keeps a poll that runs on every console page cheap;
      // `noRetryStatuses: [503]` stops the pre-migration window costing five
      // requests a minute per open tab against a route that is 503ing by
      // design (the default policy is measured at 5 requests / ~15s in
      // `http-client.test.ts`). Retrying a days-long answer buys nothing.
      await waitFor(() =>
        expect(httpGet).toHaveBeenCalledWith(
          "/api/v1/operations/notifications?limit=1",
          expect.objectContaining({ noRetryStatuses: [503] })
        )
      );
    });

    it("keeps the LAST KNOWN count when a later poll fails", async () => {
      // A poll failure is evidence about the network, not about the mailbox.
      // Clearing the badge would assert "nothing unread" on no evidence.
      let call = 0;
      httpGet.mockImplementation((url: unknown) => {
        if (String(url).startsWith("/api/v1/operations/notifications")) {
          call += 1;
          return call === 1
            ? Promise.resolve({ notifications: [], unread_count: 7 })
            : Promise.reject(new Error("GET … failed: 503 - pending"));
        }
        return Promise.resolve({ alerts: [] });
      });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        const badge = await screen.findByTestId(
          "coord-nav-notifications-badge"
        );
        expect(badge).toHaveTextContent("7");

        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() => expect(call).toBeGreaterThan(1));
        expect(
          screen.getByTestId("coord-nav-notifications-badge")
        ).toHaveTextContent("7");
      } finally {
        vi.useRealTimers();
      }
    });

    it("renders no badge when nothing is unread", async () => {
      routeGet({
        notifications: [],
        next_cursor: null,
        total: 4,
        unread_count: 0,
      });
      render(<CoordNav />);

      await waitFor(() => expect(httpGet).toHaveBeenCalled());
      expect(
        screen.queryByTestId("coord-nav-notifications-badge")
      ).not.toBeInTheDocument();
      // The Notifications tab itself still renders — only the badge is absent.
      expect(screen.getByTestId("coord-nav-notifications")).toBeInTheDocument();
    });

    it("degrades quietly while the coord migration is pending (503)", async () => {
      // Coord answers `503 schema_migration_pending` until the
      // `coord.notifications` alembic revision deploys; the web PR lands
      // first by design, so this is the EXPECTED steady state for a while.
      routeGet(new Error("503 schema_migration_pending"));
      render(<CoordNav />);

      await waitFor(() => expect(httpGet).toHaveBeenCalled());
      expect(
        screen.queryByTestId("coord-nav-notifications-badge")
      ).not.toBeInTheDocument();
      // The sibling Alerts badge is unaffected by the notifications failure.
      expect(screen.getByTestId("coord-nav-alerts")).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // The fleet alarm on the `Dev Ops ▾` trigger — Verification 7.
  //
  // These five counts used to live on the pipeline page's collapsed
  // `System details` header, kept alive by two page polls that ran whether or
  // not the drawer was open. Phase 4 deleted the drawer AND the polls; the
  // alarm reads here instead, on the nav cadence, visible from every console
  // page.
  //
  // The `unknown` case is the load-bearing one and has its own test below.
  // --------------------------------------------------------------------------

  describe("Dev Ops fleet alarm", () => {
    /** Coord wire shape — `DeviceHealthSnapshot` (fleet_health.rs). */
    function coordDevice(id: string, hostname: string, state?: string) {
      return { device_id: id, hostname, state };
    }

    /**
     * One resource-sample row. `headroom` is coord's OWN admission verdict —
     * there is no client-side band anywhere in this path, which is why a high
     * pressure ratio with `headroom: "ok"` must raise nothing.
     */
    function sample(
      deviceId: string,
      laneInstance: string | null,
      headroom: "ok" | "warn" | "breach" | undefined,
      ageSecs = 15
    ) {
      const row: Record<string, unknown> = {
        device_id: deviceId,
        lane: "host",
        lane_instance: laneInstance,
        sampled_at: "2026-08-25T12:00:00Z",
        age_secs: ageSecs,
        mem_total_bytes: 1,
        mem_available_bytes: 1,
        commit_total_bytes: 1,
        commit_available_bytes: 1,
        disk_total_bytes: 1,
        disk_free_bytes: 1,
        source: "supervisor",
        pressure: { ratio: 0.4, basis: "commit" },
        headroom,
      };
      if (headroom === undefined) delete row.headroom;
      return row;
    }

    /** Route the nav's four reads: alerts, notifications, health, samples. */
    function routeFleet(health: unknown, samples: unknown) {
      httpGet.mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes("fleet/resource-samples"))
          return Promise.resolve(samples);
        if (u.includes("fleet/health")) return Promise.resolve(health);
        if (u.startsWith("/api/v1/operations/notifications")) {
          return Promise.resolve({ notifications: [], unread_count: 0 });
        }
        return Promise.resolve({ alerts: [], total_count: 0 });
      });
    }

    it("surfaces breach, warn, stale and unknown together on the trigger", async () => {
      // Four lanes on one machine, one per class. `d-2` is reported by coord's
      // health read in a non-healthy state, which is the fifth count.
      routeFleet(
        {
          devices: [
            coordDevice("d-1", "msi", "healthy"),
            coordDevice("d-2", "nuc", "degraded"),
          ],
        },
        {
          latest: [
            sample("d-1", "a", "breach"),
            sample("d-1", "b", "warn"),
            // Far older than the staleness threshold: its last verdict was a
            // breach, but a stale sample is not a claim about now.
            sample("d-1", "c", "breach", 4000),
            // An older coord that reports no admission verdict at all.
            sample("d-1", "d", undefined),
            // `nuc` publishes normally — its contribution to the alarm is the
            // `unhealthy` count from coord's health read, not a lane verdict.
            // Without this row it would ALSO count as `unknown`, which is
            // correct behaviour but would make the assertion below ambiguous
            // about which absence produced the count.
            sample("d-2", null, "ok"),
          ],
          history: [],
        }
      );
      render(<CoordNav />);

      const trigger = screen.getByTestId("coord-nav-group-devops");
      await waitFor(() =>
        expect(
          screen.getByTestId("coord-nav-devops-breach-badge")
        ).toHaveTextContent("1 refusing work")
      );
      expect(
        screen.getByTestId("coord-nav-devops-warn-badge")
      ).toHaveTextContent("1 delaying work");
      expect(
        screen.getByTestId("coord-nav-devops-stale-badge")
      ).toHaveTextContent("1 stale");
      expect(
        screen.getByTestId("coord-nav-devops-unknown-badge")
      ).toHaveTextContent("1 unknown");
      expect(
        screen.getByTestId("coord-nav-devops-unhealthy-badge")
      ).toHaveTextContent("1 unhealthy");
      // All of them ride the group TRIGGER, so they are readable without
      // opening the menu — that is the whole point of moving them here.
      for (const id of [
        "coord-nav-devops-breach-badge",
        "coord-nav-devops-warn-badge",
        "coord-nav-devops-stale-badge",
        "coord-nav-devops-unknown-badge",
        "coord-nav-devops-unhealthy-badge",
      ]) {
        expect(trigger).toContainElement(screen.getByTestId(id));
      }
    });

    it("shows `unknown`, not silence, when the fleet's telemetry has gone dark", async () => {
      // The false-safe this badge exists to prevent: machines are registered,
      // nothing is publishing samples. A breach-only badge would render this
      // identically to an all-clear.
      routeFleet(
        { devices: [coordDevice("d-1", "msi", "healthy")] },
        { latest: [], history: [] }
      );
      render(<CoordNav />);

      await waitFor(() =>
        expect(
          screen.getByTestId("coord-nav-devops-unknown-badge")
        ).toHaveTextContent("1 unknown")
      );
      // …and it is NOT dressed as an alarm. Unknown is not red.
      expect(
        screen.getByTestId("coord-nav-devops-unknown-badge").className
      ).not.toContain("text-red-200");
      expect(
        screen.queryByTestId("coord-nav-devops-breach-badge")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("coord-nav-devops-stale-badge")
      ).not.toBeInTheDocument();
    });

    it("raises nothing when coord is still electing every lane", async () => {
      routeFleet(
        { devices: [coordDevice("d-1", "msi", "healthy")] },
        { latest: [sample("d-1", null, "ok")], history: [] }
      );
      render(<CoordNav />);

      await waitFor(() => expect(httpGet).toHaveBeenCalled());
      const trigger = screen.getByTestId("coord-nav-group-devops");
      expect(trigger).toHaveTextContent(/^Dev Ops$/);
      for (const id of [
        "coord-nav-devops-breach-badge",
        "coord-nav-devops-warn-badge",
        "coord-nav-devops-stale-badge",
        "coord-nav-devops-unknown-badge",
        "coord-nav-devops-unhealthy-badge",
      ]) {
        expect(screen.queryByTestId(id)).not.toBeInTheDocument();
      }
    });

    it("renders no alarm at all when the fleet reads fail", async () => {
      // A failed poll is evidence about the network, not about the fleet. The
      // trigger stays quiet rather than inventing either an alarm or an
      // all-clear count.
      httpGet.mockRejectedValue(new Error("boom"));
      render(<CoordNav />);

      await waitFor(() => expect(httpGet).toHaveBeenCalled());
      expect(
        screen.queryByTestId("coord-nav-devops-unknown-badge")
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("coord-nav-group-devops")).toHaveTextContent(
        /^Dev Ops$/
      );
    });
  });
});
