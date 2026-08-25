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
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let pathname = "/admin/coord/fleet";
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
    pathname = "/admin/coord/fleet";
    isSuperuser = false;
  });

  it("renders five direct tabs and every member group, Dev Ops included", async () => {
    const user = userEvent.setup();
    render(<CoordNav />);

    expect(screen.getByTestId("coord-nav-fleet")).toHaveTextContent("Pipeline");
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
    // Overview, then the nine operator-only members.
    expect(screen.getAllByRole("menuitem")).toHaveLength(10);
  });

  it("puts Overview first in the Dev Ops group", async () => {
    isSuperuser = true;
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-devops"));
    await screen.findByTestId("coord-nav-devops-overview");
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveTextContent("Overview");
    expect(items[1]).toHaveTextContent("Trees");
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
      "/admin/agent-sessions"
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
});
