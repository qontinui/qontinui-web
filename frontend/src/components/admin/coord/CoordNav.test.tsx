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
 *  - ...and that the alarm's RETAINED counts say they are retained — the same
 *    four channels the two tab badges carry, per axis, plus the retained-zero
 *    marker this trigger needs more than they do because here an all-clear is
 *    rendered as silence
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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

  it("labels a retained alert count as stale, the same as its sibling", async () => {
    // Symmetry, deliberately: both nav badges keep their number across a failed
    // poll and both are rendered by ONE path, so qualifying only the badge the
    // notifications follow-up came from would leave the identical unlabelled
    // claim on the tab beside it — which is the "applied it only where the
    // migration happened to be large" failure the style guide records for
    // /prompt-injections.
    // URL-keyed, and counted PER ROUTE. A single counter over every request
    // would be coupled to the order the three `use*Badge()` hooks happen to
    // fire in, so re-ordering them — a change with no other observable effect —
    // would silently re-point which requests get the success bodies.
    let alertsCall = 0;
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (!u.startsWith("/api/v1/operations/alerts")) {
        return Promise.resolve({ notifications: [] });
      }
      alertsCall += 1;
      if (alertsCall <= 2)
        return Promise.resolve(
          u.includes("severity=critical")
            ? { alerts: [], total_count: 0 }
            : { alerts: [], total_count: 42 }
        );
      return Promise.reject(new Error("GET … failed: 500 - boom"));
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<CoordNav />);
      const badge = await screen.findByTestId("coord-nav-alerts-badge");
      expect(badge).toHaveAttribute("data-read-stale", "false");

      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() =>
        expect(screen.getByTestId("coord-nav-alerts-badge")).toHaveAttribute(
          "data-read-stale",
          "true"
        )
      );
      const stale = screen.getByTestId("coord-nav-alerts-badge");
      expect(stale).toHaveTextContent("42*");
      expect(stale.getAttribute("title")).toMatch(/did not replace it/);
      // The base title still says WHICH number this is — the staleness
      // clause is appended to it, not substituted for it, so the two things
      // the badge cannot vouch for (`totalKnown`, `stale`) stay separable.
      expect(stale.getAttribute("title")).toMatch(/unpaged total/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not stale a count whose own read succeeded beside a failed sibling", async () => {
    // `useAlertsBadge` issues TWO reads and they fail independently. Under
    // `Promise.all` the first rejection takes the whole poll into the catch, so
    // a severity read that failed beside a count read that SUCCEEDED marked a
    // number from this very poll as "from an earlier read" — a fresh false
    // claim, made by the flag added to stop false claims. `allSettled` keeps
    // them apart: the count is current, the accent is simply retained.
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (!u.startsWith("/api/v1/operations/alerts")) {
        return Promise.resolve({ notifications: [] });
      }
      return u.includes("severity=critical")
        ? Promise.reject(new Error("GET … failed: 500 - boom"))
        : Promise.resolve({ alerts: [], total_count: 42 });
    });
    render(<CoordNav />);

    const badge = await screen.findByTestId("coord-nav-alerts-badge");
    expect(badge).toHaveTextContent("42");
    expect(badge).toHaveAttribute("data-read-stale", "false");
    expect(badge).not.toHaveTextContent("*");
  });

  it("keeps a RETAINED zero visible, because silence is an absence claim", async () => {
    // The style guide's own words: "a retained count of 7 is kept and labelled
    // old while a retained 0 would be thrown away, though both are equally
    // fetched." A badge that only renders above zero has no way to carry the
    // qualification for the zero case at all, so a last-good `0` followed by an
    // outage renders NOTHING — on every console page — and an operator reads
    // that silence as "all clear".
    let alertsCall = 0;
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (!u.startsWith("/api/v1/operations/alerts")) {
        return Promise.resolve({ notifications: [] });
      }
      alertsCall += 1;
      if (alertsCall <= 2)
        return Promise.resolve({ alerts: [], total_count: 0 });
      return Promise.reject(new Error("GET … failed: 500 - boom"));
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<CoordNav />);
      // A read that ANSWERED zero renders nothing — an all-clear fleet should
      // look like one. That arm is unchanged.
      await waitFor(() => expect(alertsCall).toBeGreaterThan(1));
      expect(
        screen.queryByTestId("coord-nav-alerts-badge")
      ).not.toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(60_000);
      const retained = await screen.findByTestId("coord-nav-alerts-badge");
      // Same zero, now RETAINED rather than answered — so it is rendered and
      // marked instead of being indistinguishable from an all-clear.
      expect(retained).toHaveTextContent("0*");
      expect(retained).toHaveAttribute("data-read-stale", "true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays silent for a zero that was NEVER read", async () => {
    // The other side of the exception, and the reason it is keyed on `hasRead`
    // rather than on `stale` alone: a first poll that fails has no retained
    // fact to qualify, so rendering `0*` would invent a measurement.
    httpGet.mockRejectedValue(new Error("GET … failed: 500 - boom"));
    render(<CoordNav />);

    await waitFor(() => expect(httpGet).toHaveBeenCalled());
    expect(
      screen.queryByTestId("coord-nav-alerts-badge")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-nav-notifications-badge")
    ).not.toBeInTheDocument();
  });

  it("never paints a retained-zero badge red off an older severity read", async () => {
    // The state the retained-zero gate CREATED. Until it landed, `count === 0`
    // could not render at all, so a `critical` retained from an older poll was
    // invisible; the gate made it reachable and it rendered `0*` inside a red
    // pill — the accent saying a critical alert is unresolved, the number
    // saying none are, and the accent being both the louder claim and the
    // older read.
    let alertsCall = 0;
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (!u.startsWith("/api/v1/operations/alerts")) {
        return Promise.resolve({ notifications: [] });
      }
      const critical = u.includes("severity=critical");
      alertsCall += 1;
      // Poll 1: 5 alerts, 3 of them critical.
      if (alertsCall <= 2) {
        return Promise.resolve({
          alerts: [],
          total_count: critical ? 3 : 5,
        });
      }
      // Poll 2: the count drops to zero; the severity read fails, so
      // `critical` stays true from poll 1.
      if (alertsCall <= 4) {
        return critical
          ? Promise.reject(new Error("GET … failed: 500 - boom"))
          : Promise.resolve({ alerts: [], total_count: 0 });
      }
      // Poll 3: the count read fails too — the retained zero now renders.
      return Promise.reject(new Error("GET … failed: 500 - boom"));
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<CoordNav />);
      const red = await screen.findByTestId("coord-nav-alerts-badge");
      expect(red.className).toContain("text-red-200");

      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() =>
        expect(
          screen.queryByTestId("coord-nav-alerts-badge")
        ).not.toBeInTheDocument()
      );

      await vi.advanceTimersByTimeAsync(60_000);
      const retained = await screen.findByTestId("coord-nav-alerts-badge");
      expect(retained).toHaveTextContent("0*");
      // The whole point: a fresher zero outranks an older critical.
      expect(retained.className).not.toContain("text-red-200");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so when the severity read has not answered, instead of looking calm", async () => {
    // "No red" has three causes and only one of them is "nothing is critical".
    // Splitting the two reads so a severity failure cannot stale the COUNT was
    // half the fix; reporting only the count's currency left the accent making
    // an unqualified claim — an established negative built out of an unknown,
    // in the one place an operator most needs it not to be.
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (!u.startsWith("/api/v1/operations/alerts")) {
        return Promise.resolve({ notifications: [] });
      }
      return u.includes("severity=critical")
        ? Promise.reject(new Error("GET … failed: 500 - boom"))
        : Promise.resolve({ alerts: [], total_count: 42 });
    });
    render(<CoordNav />);

    const badge = await screen.findByTestId("coord-nav-alerts-badge");
    // The COUNT is current — that split is still right, and still tested.
    expect(badge).toHaveAttribute("data-read-stale", "false");
    expect(badge).not.toHaveTextContent("*");
    // The ACCENT is not, and now says so.
    expect(badge).toHaveAttribute("data-critical-known", "false");
    expect(badge.getAttribute("title")).toMatch(/critical is UNKNOWN/);
    expect(badge.textContent).toMatch(/critical is UNKNOWN/);
    expect(badge.className).not.toContain("text-red-200");
  });

  it("does not render a lower bound of zero, which is true of everything", async () => {
    // The degraded arm (`total_count` absent) counts the returned window, and
    // an empty window is a legitimate answer — so `≥0*` was reachable, arriving
    // information-free and stacked with the staleness marker in the one place
    // the design is trying to stay legible.
    let alertsCall = 0;
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (!u.startsWith("/api/v1/operations/alerts")) {
        return Promise.resolve({ notifications: [] });
      }
      alertsCall += 1;
      // An un-upgraded coord: no `total_count`, and an empty window.
      if (alertsCall <= 2) return Promise.resolve({ alerts: [] });
      return Promise.reject(new Error("GET … failed: 500 - boom"));
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<CoordNav />);
      await waitFor(() => expect(alertsCall).toBeGreaterThan(1));
      await vi.advanceTimersByTimeAsync(60_000);
      const badge = await screen.findByTestId("coord-nav-alerts-badge");
      expect(badge).toHaveAttribute("data-total-known", "false");
      expect(badge).toHaveTextContent("0*");
      expect(badge).not.toHaveTextContent("≥");
    } finally {
      vi.useRealTimers();
    }
  });

  it("will not conclude 'nothing is critical' from a one-row sample", async () => {
    // The 2026-08-14 defect INVERTED, and in the reassuring direction. That one
    // was "critical was unconditionally true because the served window happened
    // to be 100% critical — a flag that is always on carries no information".
    // An un-upgraded coord drops the `severity` filter as well as `limit`, so
    // the degraded arm was reading a capped, unfiltered window and answering
    // `false` when it held no critical row: a fleet-wide negative from a sample
    // of one, published as KNOWN, with no red and nothing in the tooltip.
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (!u.startsWith("/api/v1/operations/alerts")) {
        return Promise.resolve({ notifications: [] });
      }
      // No `total_count` on either read; the severity filter was dropped, so
      // both answer with the same one-row window, and that row is a warning.
      return Promise.resolve({ alerts: [{ severity: "warning" }] });
    });
    render(<CoordNav />);

    const badge = await screen.findByTestId("coord-nav-alerts-badge");
    expect(badge).toHaveAttribute("data-critical-known", "false");
    expect(badge.getAttribute("title")).toMatch(/critical is UNKNOWN/);
    expect(badge.className).not.toContain("text-red-200");
  });

  it("will not read a RESOLVED critical as an unresolved one", async () => {
    // The hole in "existence survives sampling". This arm fires on exactly the
    // build that ignored `severity` — and `include_resolved=false` is a filter
    // on the same request, with nothing in the response saying which filters
    // were honoured. Reading severity alone asserted an UNRESOLVED critical,
    // in a red pill with no qualification, off a row coord had already cleared.
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (!u.startsWith("/api/v1/operations/alerts")) {
        return Promise.resolve({ notifications: [] });
      }
      return Promise.resolve({
        alerts: [{ severity: "critical", resolved_at: "2026-08-31T09:00:00Z" }],
      });
    });
    render(<CoordNav />);

    const badge = await screen.findByTestId("coord-nav-alerts-badge");
    expect(badge.className).not.toContain("text-red-200");
    // Not "no criticals" either — the window proves nothing either way.
    expect(badge).toHaveAttribute("data-critical-known", "false");
    expect(badge.getAttribute("title")).toMatch(/critical is UNKNOWN/);
  });

  it("still believes a critical it can SEE in the sample", async () => {
    // The other half, and the reason this is not just "distrust the degraded
    // arm": existence survives sampling even when absence does not. A critical
    // row IN the window proves a critical exists, whatever the window's size.
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (!u.startsWith("/api/v1/operations/alerts")) {
        return Promise.resolve({ notifications: [] });
      }
      return Promise.resolve({
        alerts: [{ severity: u.includes("severity=critical") ? "critical" : "warning" }],
      });
    });
    render(<CoordNav />);

    const badge = await screen.findByTestId("coord-nav-alerts-badge");
    expect(badge).toHaveAttribute("data-critical-known", "true");
    expect(badge.className).toContain("text-red-200");
  });

  it("does not say a never-read axis is from an EARLIER read", async () => {
    // "Stale" means "from an earlier read"; an axis that has never read has no
    // earlier read to be from. The count axes hide this behind the render gate,
    // so it only became visible when the critical axis started publishing.
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (!u.startsWith("/api/v1/operations/alerts")) {
        return Promise.resolve({ notifications: [] });
      }
      return u.includes("severity=critical")
        ? Promise.reject(new Error("GET … failed: 500 - boom"))
        : Promise.resolve({ alerts: [], total_count: 42 });
    });
    render(<CoordNav />);

    const badge = await screen.findByTestId("coord-nav-alerts-badge");
    expect(badge).toHaveAttribute("data-critical-known", "false");
    // UNKNOWN, and therefore NOT stale — two different claims, and only one of
    // them is true here.
    expect(badge).toHaveAttribute("data-critical-stale", "false");
  });

  it("does not promise 'at LEAST this many' about a zero", async () => {
    // Suppressing the `≥` glyph and leaving the sentence would have moved the
    // vacuous claim into the channel the fix routed everything else into: the
    // title still read "this coord build does not report a total — at LEAST
    // this many" over a `0`, which is true of every state there is.
    let alertsCall = 0;
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (!u.startsWith("/api/v1/operations/alerts")) {
        return Promise.resolve({ notifications: [] });
      }
      alertsCall += 1;
      if (alertsCall <= 2) return Promise.resolve({ alerts: [] });
      return Promise.reject(new Error("GET … failed: 500 - boom"));
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<CoordNav />);
      await waitFor(() => expect(alertsCall).toBeGreaterThan(1));
      await vi.advanceTimersByTimeAsync(60_000);
      const badge = await screen.findByTestId("coord-nav-alerts-badge");
      expect(badge).toHaveTextContent("0*");
      expect(badge.getAttribute("title")).not.toMatch(/at LEAST/);
      // ...and the fresh-total sentence is not the fallback either: claiming
      // "coord's unpaged total" about a build that served no total would trade
      // one false claim for a worse one.
      expect(badge.getAttribute("title")).not.toMatch(/unpaged total/);
      expect(badge.getAttribute("title")).toMatch(/how many there are is UNKNOWN/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never lets `known` describe a read whose number was declined", async () => {
    // `setKnown` fires only when the axis APPLIED the value. Without that
    // guard a superseded reply that the axis correctly declined still
    // overwrites `known`, so the badge renders a degraded count (a floor)
    // while claiming coord served an exact total — or the reverse.
    let resolveA: ((v: unknown) => void) | null = null;
    let countCall = 0;
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (!u.startsWith("/api/v1/operations/alerts")) {
        return Promise.resolve({ notifications: [] });
      }
      if (u.includes("severity=critical")) {
        return Promise.resolve({ alerts: [], total_count: 0 });
      }
      countCall += 1;
      if (countCall === 1) {
        // Poll A hangs, and will answer with an EXACT total.
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      // Poll B lands first, degraded: no total, a two-row window.
      return Promise.resolve({
        alerts: [{ severity: "warning" }, { severity: "warning" }],
      });
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<CoordNav />);
      await vi.advanceTimersByTimeAsync(60_000);
      const badge = await screen.findByTestId("coord-nav-alerts-badge");
      expect(badge).toHaveTextContent("≥2");
      expect(badge).toHaveAttribute("data-total-known", "false");

      // A lands late with an exact total. Its VALUE is declined (older read),
      // so its `known` must be declined with it.
      await act(async () => {
        resolveA?.({ alerts: [], total_count: 5 });
        await Promise.resolve();
      });

      const after = screen.getByTestId("coord-nav-alerts-badge");
      expect(after).toHaveTextContent("≥2");
      expect(after).toHaveAttribute("data-total-known", "false");
    } finally {
      vi.useRealTimers();
    }
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


  // ---------------------------------------------------------------------------
  // Agent Commands / Agent Skills — plan `2026-08-20-fleet-served-agent-skills`,
  // Phase 3. Both live in WORK beside Agents, not in Merge: filing agent tooling
  // under a group labelled "Merge" fails the discoverability gate.
  // ---------------------------------------------------------------------------


  // ---------------------------------------------------------------------------
  // Agent Commands / Agent Skills — plan `2026-08-20-fleet-served-agent-skills`,
  // Phase 3. Both live in WORK beside Agents, not in Merge: filing agent tooling
  // under a group labelled "Merge" fails the discoverability gate.
  // ---------------------------------------------------------------------------

  it("offers Agent Commands and Agent Skills in the Work group, beside Agents", async () => {
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-work"));
    const commands = await screen.findByTestId("coord-nav-agent-commands");
    expect(commands).toBeVisible();
    expect(commands).toHaveTextContent("Agent Commands");
    expect(commands).toHaveAttribute("href", "/admin/coord/agent-commands");

    const skills = screen.getByTestId("coord-nav-agent-skills");
    expect(skills).toBeVisible();
    expect(skills).toHaveTextContent("Agent Skills");
    expect(skills).toHaveAttribute("href", "/admin/coord/agent-skills");

    // Beside the existing Agents item, in the same group.
    expect(screen.getByTestId("coord-nav-agents")).toBeVisible();
  });


  it("keeps agent tooling out of the Merge group", async () => {
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-merge"));
    // Control: prove the Merge group actually OPENED, so the two absence
    // assertions below mean "not in Merge" rather than "nothing rendered yet".
    // This was `coord-nav-policies` when the test was written; plan
    // `2026-08-25-coord-console-intent-and-devops-sections` Phase 3 moved
    // Policies into the new Intent group, so the control now names an item
    // that is still in Merge.
    await screen.findByTestId("coord-nav-pull-decisions");
    expect(
      screen.queryByTestId("coord-nav-agent-commands")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-nav-agent-skills")
    ).not.toBeInTheDocument();
  });


  it("shows both agent-tooling items to a plain member", async () => {
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-work"));
    // The corpus is READABLE by any member; only a fleet-layer WRITE is
    // superuser-gated, and that gate lives on the page, not on the nav.
    expect(await screen.findByTestId("coord-nav-agent-commands")).toBeVisible();
    expect(screen.getByTestId("coord-nav-agent-skills")).toBeVisible();
  });


  // A FOURTH `/admin/coord/agent*` href landed on main while this branch was
  // open (`agent-registry`, in ACCESS not Work). It shares the same string
  // prefix as the Work trio and is the exact shape the test above exists to
  // catch, so it gets pinned rather than assumed: no Work crumb may claim it.
  it("leaves every Work crumb alone on /admin/coord/agent-registry", () => {
    pathname = "/admin/coord/agent-registry";
    render(<CoordNav />);

    for (const id of [
      "coord-nav-agents-active",
      "coord-nav-agent-commands-active",
      "coord-nav-agent-skills-active",
    ]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
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

    it("says the retained count is from an earlier read — and only then", async () => {
      // The DISCRIMINATION, not each arm against the text it happens to emit:
      // a fresh 7 and a retained 7 render the same number, so the test above
      // ("keeps the LAST KNOWN count") passes just as happily against a badge
      // that says nothing about where the 7 came from — which is exactly what
      // this hook shipped. What has to differ is the QUALIFICATION.
      let call = 0;
      httpGet.mockImplementation((url: unknown) => {
        if (String(url).startsWith("/api/v1/operations/notifications")) {
          call += 1;
          return call === 1
            ? Promise.resolve({ notifications: [], unread_count: 7 })
            : Promise.reject(new Error("GET … failed: 500 - boom"));
        }
        return Promise.resolve({ alerts: [] });
      });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        const fresh = await screen.findByTestId(
          "coord-nav-notifications-badge"
        );
        expect(fresh).toHaveTextContent("7");
        // The attribute is EMITTED on the fresh arm too — "false" is the
        // answer "the last read replaced this number", which is a different
        // claim from a badge that never asked the question.
        expect(fresh).toHaveAttribute("data-read-stale", "false");
        const freshTitle = fresh.getAttribute("title");
        const freshText = fresh.textContent;
        // It had no title at all before this; the one channel that could
        // carry the qualification was empty.
        expect(freshTitle).toBeTruthy();
        expect(freshTitle).not.toMatch(/did not replace it/);
        expect(freshText).toBe("7");

        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() =>
          expect(
            screen.getByTestId("coord-nav-notifications-badge")
          ).toHaveAttribute("data-read-stale", "true")
        );
        const stale = screen.getByTestId("coord-nav-notifications-badge");
        // The number is still KEPT — that half was always right.
        expect(stale).toHaveTextContent("7");
        const staleTitle = stale.getAttribute("title");
        expect(staleTitle).toMatch(/did not replace it/);
        // A VISIBLE marker, not a colour or an opacity: the qualification has
        // to survive being read, and dimming 10px bold text makes the stale
        // state the hardest one to read.
        expect(stale).toHaveTextContent("7*");
        // ...and the same words in the accessible name, since `title` on this
        // span is not one — the link's name comes from its content.
        expect(stale.textContent).toMatch(/did not replace it/);
        // The two states produce two DIFFERENT outputs, in every channel. This
        // is the assertion that could not have been satisfied before.
        expect(staleTitle).not.toBe(freshTitle);
        expect(stale.textContent).not.toBe(freshText);
      } finally {
        vi.useRealTimers();
      }
    });

    it("goes stale on a 2xx that carried no scalar, not just on a rejection", async () => {
      // `stale` is "the most recent read did not REPLACE this number", and a
      // 200 with no `unread_count` did not. The first cut only declined to
      // CLEAR the flag here, which is half of it: against a coord build that
      // permanently omits the scalar — the degrade the page's `applyEnvelope`
      // documents as reachable — the badge then renders poll 1's number as
      // current forever, undimmed and unmarked.
      let call = 0;
      httpGet.mockImplementation((url: unknown) => {
        if (String(url).startsWith("/api/v1/operations/notifications")) {
          call += 1;
          return call === 1
            ? Promise.resolve({ unread_count: 7 })
            : Promise.resolve({ notifications: [] });
        }
        return Promise.resolve({ alerts: [] });
      });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        const badge = await screen.findByTestId(
          "coord-nav-notifications-badge"
        );
        expect(badge).toHaveAttribute("data-read-stale", "false");

        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() => expect(call).toBeGreaterThan(1));
        const after = screen.getByTestId("coord-nav-notifications-badge");
        // The number is retained — the read said nothing about it — and now
        // marked, because nothing refreshed it.
        expect(after).toHaveTextContent("7*");
        expect(after).toHaveAttribute("data-read-stale", "true");
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not un-stale itself on a 2xx that carried no scalar", async () => {
      // The subtle arm. A coord build predating `unread_count` answers 200
      // with no scalar — reachable enough that the page's `applyEnvelope`
      // documents it — so the read LANDED but replaced nothing. Clearing the
      // flag on any 2xx would re-tell the lie while the number on screen is
      // still the one from before the outage.
      let call = 0;
      httpGet.mockImplementation((url: unknown) => {
        if (String(url).startsWith("/api/v1/operations/notifications")) {
          call += 1;
          if (call === 1) return Promise.resolve({ unread_count: 7 });
          if (call === 2)
            return Promise.reject(new Error("GET … failed: 500 - boom"));
          return Promise.resolve({ notifications: [] });
        }
        return Promise.resolve({ alerts: [] });
      });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        await screen.findByTestId("coord-nav-notifications-badge");
        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() =>
          expect(
            screen.getByTestId("coord-nav-notifications-badge")
          ).toHaveAttribute("data-read-stale", "true")
        );
        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() => expect(call).toBeGreaterThan(2));
        const badge = screen.getByTestId("coord-nav-notifications-badge");
        expect(badge).toHaveTextContent("7");
        expect(badge).toHaveAttribute("data-read-stale", "true");
      } finally {
        vi.useRealTimers();
      }
    });

    it("lets a superseded reply say nothing about the read that overtook it", async () => {
      // Fire-and-forget on a 60s timer was fine while nothing here made a claim
      // about WHEN a number was read. `stale` does. Poll A hangs past the next
      // tick; poll B succeeds and refreshes the count; A then rejects — and
      // without a guard that rejection marks B's fresh number as coming from an
      // earlier read. The page next door carries the same guard and says why:
      // narrowing a race is not closing it.
      let rejectA: ((e: Error) => void) | null = null;
      let call = 0;
      httpGet.mockImplementation((url: unknown) => {
        if (!String(url).startsWith("/api/v1/operations/notifications")) {
          return Promise.resolve({ alerts: [] });
        }
        call += 1;
        if (call === 1) {
          return new Promise((_resolve, reject) => {
            rejectA = reject;
          });
        }
        return Promise.resolve({ unread_count: 9 });
      });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        // A is still in flight; B fires on the next tick and lands.
        await vi.advanceTimersByTimeAsync(60_000);
        const badge = await screen.findByTestId(
          "coord-nav-notifications-badge"
        );
        expect(badge).toHaveTextContent("9");

        // Now A fails, describing a read two polls old. Inside `act` so the
        // rejection's handler AND any state update it makes are flushed before
        // the assertion — without that this test passes with the guard removed,
        // which makes it a test of nothing.
        await act(async () => {
          rejectA?.(new Error("GET … failed: 500 - boom"));
          await Promise.resolve();
        });

        const after = screen.getByTestId("coord-nav-notifications-badge");
        expect(after).toHaveAttribute("data-read-stale", "false");
        expect(after).toHaveTextContent("9");
        expect(after).not.toHaveTextContent("*");
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps a superseded reply's NUMBER while still calling it uncurrent", async () => {
      // The other direction of the ordering problem, and the one the first
      // guard got wrong. "Ignore anything but the newest request ISSUED" drops
      // a superseded but SUCCESSFUL read: poll A hangs, poll B fails, A then
      // answers with a real number — and the badge discarded it and rendered
      // nothing at all. That is information loss, the opposite of the stale
      // arm's "those numbers are real and still actionable".
      //
      // Sequences, not a boolean: A delivered (seq 1), B completed without
      // delivering (seq 2), so the number is A's and it is uncurrent.
      let resolveA: ((v: unknown) => void) | null = null;
      let call = 0;
      httpGet.mockImplementation((url: unknown) => {
        if (!String(url).startsWith("/api/v1/operations/notifications")) {
          return Promise.resolve({ alerts: [] });
        }
        call += 1;
        if (call === 1) {
          return new Promise((resolve) => {
            resolveA = resolve;
          });
        }
        return Promise.reject(new Error("GET … failed: 500 - boom"));
      });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        // B fires and fails while A is still in flight. Nothing has ever been
        // delivered, so nothing renders.
        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() => expect(call).toBeGreaterThan(1));
        expect(
          screen.queryByTestId("coord-nav-notifications-badge")
        ).not.toBeInTheDocument();

        // Now A lands, late, with a real number.
        await act(async () => {
          resolveA?.({ unread_count: 12 });
          await Promise.resolve();
        });

        const badge = await screen.findByTestId(
          "coord-nav-notifications-badge"
        );
        // Kept — a real read delivered it.
        expect(badge).toHaveTextContent("12");
        // ...and marked, because a NEWER read finished without replacing it.
        expect(badge).toHaveAttribute("data-read-stale", "true");
        expect(badge).toHaveTextContent("12*");
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
      // ...and not the retained-zero marker either. That one is keyed on
      // `hasRead`, so a fleet whose FIRST reads failed has no retained
      // all-clear to qualify and inventing one would be a measurement.
      expect(
        screen.queryByTestId("coord-nav-devops-retained-all-clear-badge")
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("coord-nav-group-devops")).toHaveTextContent(
        /^Dev Ops$/
      );
    });

    // ------------------------------------------------------------------------
    // The retained counts, and whether they admit to being retained.
    //
    // `useFleetAlarmBadge` KEEPS its last good counts across a failed poll,
    // which is right and argued at length in its own docstring. It then
    // rendered them exactly like counts a poll had just confirmed — the silent
    // half of R6's stale arm, the same defect #1206 fixed one badge over, on
    // the third poller `CoordNav` mounts.
    // ------------------------------------------------------------------------

    /**
     * Route the nav's four reads, failing the fleet ones after `okPolls`
     * successful rounds. `which` picks WHICH fleet read starts failing, which
     * is what makes the per-axis assertions below possible.
     */
    function routeFleetFailingAfter(
      health: unknown,
      samples: unknown,
      okPolls: number,
      which: "health" | "samples" | "both"
    ) {
      let healthCalls = 0;
      let sampleCalls = 0;
      httpGet.mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes("fleet/resource-samples")) {
          sampleCalls += 1;
          if (which !== "health" && sampleCalls > okPolls)
            return Promise.reject(new Error("GET … failed: 500 - boom"));
          return Promise.resolve(samples);
        }
        if (u.includes("fleet/health")) {
          healthCalls += 1;
          if (which !== "samples" && healthCalls > okPolls)
            return Promise.reject(new Error("GET … failed: 500 - boom"));
          return Promise.resolve(health);
        }
        if (u.startsWith("/api/v1/operations/notifications")) {
          return Promise.resolve({ notifications: [], unread_count: 0 });
        }
        return Promise.resolve({ alerts: [], total_count: 0 });
      });
    }

    it("marks a retained count as retained, in all four channels", async () => {
      routeFleetFailingAfter(
        { devices: [coordDevice("d-1", "msi", "healthy")] },
        { latest: [sample("d-1", "a", "breach")], history: [] },
        1,
        "both"
      );
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        const fresh = await screen.findByTestId("coord-nav-devops-breach-badge");
        expect(fresh).toHaveTextContent("1 refusing work");
        expect(fresh).toHaveAttribute("data-read-stale", "false");

        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() =>
          expect(
            screen.getByTestId("coord-nav-devops-breach-badge")
          ).toHaveAttribute("data-read-stale", "true")
        );
        const stale = screen.getByTestId("coord-nav-devops-breach-badge");
        // 1. the visible glyph, directly after the number
        expect(stale).toHaveTextContent("1* refusing work");
        // 2. the tooltip keeps its own sentence AND gains the qualification
        expect(stale.getAttribute("title")).toContain(
          "coord's admission actually enforces"
        );
        expect(stale.getAttribute("title")).toContain("from an earlier read");
        // 3. the screen-reader note — `title` is not an accessible name on a
        //    span with content, so without this the qualification reaches only
        //    a sighted mouse user.
        expect(
          stale.querySelector(".sr-only")?.textContent
        ).toContain("from an earlier read");
      } finally {
        vi.useRealTimers();
      }
    });

    it("qualifies only the axis that failed: a dead samples read leaves `unhealthy` fresh", async () => {
      // The two reads fail independently and the counts do not all depend on
      // both. `unhealthy` is coord's HEALTH read alone; the four admission
      // counts are health AND samples. One flag across all five would either
      // over-claim on `unhealthy` or under-claim on the other four.
      routeFleetFailingAfter(
        { devices: [coordDevice("d-1", "msi", "degraded")] },
        { latest: [sample("d-1", "a", "warn")], history: [] },
        1,
        "samples"
      );
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        await screen.findByTestId("coord-nav-devops-warn-badge");

        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() =>
          expect(
            screen.getByTestId("coord-nav-devops-warn-badge")
          ).toHaveAttribute("data-read-stale", "true")
        );
        // The health read kept answering, so this count IS current and must not
        // wear the marker — an over-claim is as wrong as an under-claim.
        const unhealthy = screen.getByTestId(
          "coord-nav-devops-unhealthy-badge"
        );
        expect(unhealthy).toHaveAttribute("data-read-stale", "false");
        expect(unhealthy).toHaveTextContent("1 unhealthy");
        expect(unhealthy).not.toHaveTextContent("*");
      } finally {
        vi.useRealTimers();
      }
    });

    it("treats a 2xx carrying no device roster as a read that refreshed nothing", async () => {
      // `devices` is OPTIONAL on `FleetHealthPayload`, and the /fleet/health
      // route's own OpenAPI contract documents a mid-request degrade that still
      // answers 200. `counts` collapses to ZERO without a roster, and ZERO
      // renders as SILENCE here — so treating the absence as data would turn a
      // degraded coord into a confident, unqualified all-clear.
      let healthCalls = 0;
      httpGet.mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes("fleet/resource-samples"))
          return Promise.resolve({ latest: [], history: [] });
        if (u.includes("fleet/health")) {
          healthCalls += 1;
          // The degrade: a 200 whose envelope carries no roster at all.
          return Promise.resolve(
            healthCalls === 1
              ? { devices: [coordDevice("d-1", "msi", "degraded")] }
              : { as_of: "2026-08-25T12:00:00Z" }
          );
        }
        if (u.startsWith("/api/v1/operations/notifications"))
          return Promise.resolve({ notifications: [], unread_count: 0 });
        return Promise.resolve({ alerts: [], total_count: 0 });
      });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        await waitFor(() =>
          expect(
            screen.getByTestId("coord-nav-devops-unhealthy-badge")
          ).toHaveTextContent("1 unhealthy")
        );

        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() => expect(healthCalls).toBeGreaterThan(1));
        // The machine is still counted — the roster we hold is the last one
        // coord actually sent — and it now says it is a retained figure.
        const badge = screen.getByTestId("coord-nav-devops-unhealthy-badge");
        expect(badge).toHaveTextContent("1* unhealthy");
        expect(badge).toHaveAttribute("data-read-stale", "true");
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps an EMPTY roster as a delivery — `devices: []` is a real answer", async () => {
      // The other side of the predicate, and the reason it tests for an ARRAY
      // rather than for truthiness. Asserted through the RETAINED-ZERO marker
      // rather than through the quiet first render, because a first render is
      // quiet either way: a never-delivered axis and a delivered-empty one both
      // render nothing, so only the failing SECOND poll separates them.
      let polls = 0;
      httpGet.mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes("fleet/resource-samples") || u.includes("fleet/health")) {
          if (u.includes("fleet/health")) polls += 1;
          if (polls > 1)
            return Promise.reject(new Error("GET … failed: 500 - boom"));
          return Promise.resolve(
            u.includes("fleet/health")
              ? { devices: [] }
              : { latest: [], history: [] }
          );
        }
        if (u.startsWith("/api/v1/operations/notifications"))
          return Promise.resolve({ notifications: [], unread_count: 0 });
        return Promise.resolve({ alerts: [], total_count: 0 });
      });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        await waitFor(() => expect(polls).toBe(1));
        expect(
          screen.queryByTestId("coord-nav-devops-retained-all-clear-badge")
        ).not.toBeInTheDocument();

        await vi.advanceTimersByTimeAsync(60_000);
        // An empty roster IS a retained fact, so the failed poll that follows
        // has something to qualify. Read `devices: []` as a non-delivery and
        // this marker never appears, because nothing was ever delivered.
        const marker = await screen.findByTestId(
          "coord-nav-devops-retained-all-clear-badge"
        );
        expect(marker).toHaveTextContent("0* alarms");
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps an EMPTY lane list as a delivery — that is the telemetry-dark answer", async () => {
      // `latest: []` is exactly the fleet-gone-dark case the `unknown` count is
      // built to render, so it must REPLACE the lane verdicts rather than
      // leaving the previous ones standing behind a stale marker.
      let sampleCalls = 0;
      httpGet.mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes("fleet/resource-samples")) {
          sampleCalls += 1;
          return Promise.resolve(
            sampleCalls === 1
              ? { latest: [sample("d-1", "a", "breach")], history: [] }
              : { latest: [], history: [] }
          );
        }
        if (u.includes("fleet/health"))
          return Promise.resolve({
            devices: [coordDevice("d-1", "msi", "healthy")],
          });
        if (u.startsWith("/api/v1/operations/notifications"))
          return Promise.resolve({ notifications: [], unread_count: 0 });
        return Promise.resolve({ alerts: [], total_count: 0 });
      });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        await waitFor(() =>
          expect(
            screen.getByTestId("coord-nav-devops-breach-badge")
          ).toHaveTextContent("1 refusing work")
        );

        await vi.advanceTimersByTimeAsync(60_000);
        // The lane went dark. That is a current, delivered fact — `unknown`,
        // unmarked — not a retained breach wearing a `*`.
        const unknown = await screen.findByTestId(
          "coord-nav-devops-unknown-badge"
        );
        expect(unknown).toHaveTextContent("1 unknown");
        expect(unknown).toHaveAttribute("data-read-stale", "false");
        expect(
          screen.queryByTestId("coord-nav-devops-breach-badge")
        ).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not restamp the sample clock for a reply it declined", async () => {
      // The clock `summarizeFleetAdmission` ages lanes against is stamped on a
      // samples SUCCESS. A superseded reply is a success the axis DECLINED, and
      // stamping for it would make the stamp describe rows that were thrown
      // away — springing lanes an even newer read had already aged into `stale`
      // back to a fresh verdict.
      //
      // Reached by hanging the mount poll's samples read past the next one.
      let releaseFirstSamples: (v: unknown) => void = () => {};
      const firstSamples = new Promise((resolve) => {
        releaseFirstSamples = resolve;
      });
      // `age_secs: 100` against a 120 s threshold: current when it lands,
      // stale 30 s later, and fresh again if the clock is wrongly restamped.
      const rows = {
        latest: [sample("d-1", "a", "breach", 100)],
        history: [],
      };
      let sampleCalls = 0;
      httpGet.mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes("fleet/resource-samples")) {
          sampleCalls += 1;
          return sampleCalls === 1 ? firstSamples : Promise.resolve(rows);
        }
        if (u.includes("fleet/health"))
          return Promise.resolve({
            devices: [coordDevice("d-1", "msi", "healthy")],
          });
        if (u.startsWith("/api/v1/operations/notifications"))
          return Promise.resolve({ notifications: [], unread_count: 0 });
        return Promise.resolve({ alerts: [], total_count: 0 });
      });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        // The second poll delivers the rows; the first is still hanging.
        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() =>
          expect(
            screen.getByTestId("coord-nav-devops-breach-badge")
          ).toHaveTextContent("1 refusing work")
        );

        // 30 s on, the lane has aged past the threshold. Stop short of the
        // third poll, which would deliver the rows again and reset the clock
        // legitimately.
        await vi.advanceTimersByTimeAsync(30_000);
        await waitFor(() =>
          expect(
            screen.getByTestId("coord-nav-devops-stale-badge")
          ).toHaveTextContent("1 stale")
        );

        // Now the superseded reply lands. It carries the same rows, so nothing
        // about the lane changed — only the clock is at risk.
        await act(async () => {
          releaseFirstSamples(rows);
          await firstSamples;
        });
        expect(
          screen.getByTestId("coord-nav-devops-stale-badge")
        ).toHaveTextContent("1 stale");
        expect(
          screen.queryByTestId("coord-nav-devops-breach-badge")
        ).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps a marker for a retained ALL-CLEAR it can no longer vouch for", async () => {
      // The reason this trigger needs the retained zero more than the tab
      // badges do: here an all-clear is rendered as SILENCE, so a last-good
      // all-clear whose next poll fails states "nothing is wrong" in the
      // loudest medium the nav has, on no current evidence.
      routeFleetFailingAfter(
        { devices: [coordDevice("d-1", "msi", "healthy")] },
        { latest: [sample("d-1", null, "ok")], history: [] },
        1,
        "both"
      );
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        // A read that ANSWERED all-clear renders nothing. That arm is
        // unchanged — an all-clear fleet should look like an all-clear.
        await waitFor(() => expect(httpGet).toHaveBeenCalled());
        expect(
          screen.queryByTestId("coord-nav-devops-retained-all-clear-badge")
        ).not.toBeInTheDocument();

        await vi.advanceTimersByTimeAsync(60_000);
        const marker = await screen.findByTestId(
          "coord-nav-devops-retained-all-clear-badge"
        );
        expect(marker).toHaveTextContent("0* alarms");
        expect(marker).toHaveAttribute("data-read-stale", "true");
        expect(marker.getAttribute("title")).toContain("no fleet alarms");
        // One marker, not five `0*` pills — an alarm's worth of visual weight
        // for the absence of alarms is what makes a nav trigger unscannable.
        for (const id of [
          "coord-nav-devops-breach-badge",
          "coord-nav-devops-warn-badge",
          "coord-nav-devops-stale-badge",
          "coord-nav-devops-unknown-badge",
          "coord-nav-devops-unhealthy-badge",
        ]) {
          expect(screen.queryByTestId(id)).not.toBeInTheDocument();
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
