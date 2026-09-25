/**
 * CoordNav — the Coord Console header's status row.
 *
 * The console's page structure (groups, membership, operator gating) is
 * pinned in `coordNavModel.test.ts`, and the sidebar that renders it in
 * `navigation/sidebar/nav-items.test.ts`. Contracts under test here:
 *  - wayfinding crumb: the current page's group and label, exposing
 *    `<testid>-active` for every console page, since Spec-CI keys on it
 *  - NO Alerts link or badge: the raw alert list left the operator UI (plan
 *    `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
 *    Phase 8) and its rollup is the Dev Ops page's Conditions panel
 *  - live Notifications badge from the server's `unread_count` SCALAR —
 *    never the returned page length (plan
 *    `2026-08-05-coord-notifications-type-and-tab.md`, Change 4)
 *  - the FLEET ALARM on the Dev Ops link (Verification 7 of
 *    `2026-08-25-coord-console-intent-and-devops-sections`), including the
 *    `unknown` count, which is the one that must survive: a link that showed
 *    only breaches would render a fleet whose telemetry has gone dark exactly
 *    like a healthy one
 *  - ...and that the alarm's RETAINED counts say they are retained — the same
 *    channels the notifications badge carries, per axis, plus the retained-zero
 *    marker this link needs more than they do because here an all-clear is
 *    rendered as silence
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";

let pathname = "/admin/coord/pipeline";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));


const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
  },
}));

import CoordNav from "./CoordNav";
import { DIRECT_TABS, GROUPS } from "./coordNavModel";

describe("CoordNav", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpGet.mockResolvedValue({ notifications: [], unread_count: 0 });
    pathname = "/admin/coord/pipeline";
  });

  it("renders a direct tab's crumb with no group", () => {
    render(<CoordNav />);

    const crumb = screen.getByTestId("coord-nav-crumb");
    expect(crumb).toHaveTextContent(/^Pipeline$/);
    expect(crumb).toContainElement(
      screen.getByTestId("coord-nav-pipeline-active")
    );
  });

  it("names the group and the page for a grouped page", () => {
    pathname = "/admin/coord/lands";
    render(<CoordNav />);

    const crumb = screen.getByTestId("coord-nav-crumb");
    expect(crumb).toHaveTextContent("Work·Lands");
    expect(screen.getByTestId("coord-nav-lands-active")).toHaveTextContent(
      "Lands"
    );
  });

  it("keeps the crumb on a page's detail routes", () => {
    pathname = "/admin/coord/plans/some-plan-slug";
    render(<CoordNav />);

    expect(screen.getByTestId("coord-nav-plans-active")).toHaveTextContent(
      "Plans"
    );
  });

  it("exposes a `-active` crumb for every console page, whatever the role", () => {
    // Spec-CI's "active section" selectors match `coord-nav-<x>-active`. The
    // crumb describes where you ARE, so it needs no role: it holds for
    // operator-only pages too.
    for (const leaf of [...DIRECT_TABS, ...GROUPS.flatMap((g) => g.items)]) {
      pathname = leaf.href;
      const view = render(<CoordNav />);
      expect(
        within(view.container).getByTestId(`${leaf.testId}-active`)
      ).toHaveTextContent(leaf.label);
      view.unmount();
    }
  });

  it("renders no crumb off the console's pages", () => {
    pathname = "/admin/coord";
    render(<CoordNav />);
    expect(screen.queryByTestId("coord-nav-crumb")).not.toBeInTheDocument();
  });

  it("links the event surface and the Dev Ops overview — and no alerts page", () => {
    render(<CoordNav />);

    expect(screen.getByTestId("coord-nav-notifications")).toHaveAttribute(
      "href",
      "/admin/coord/notifications"
    );
    expect(screen.getByTestId("coord-nav-devops-alarm")).toHaveAttribute(
      "href",
      "/admin/coord/devops"
    );
    // The raw alert list is agents' work now; nothing on this row links to it
    // or polls it.
    expect(screen.queryByTestId("coord-nav-alerts")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-nav-alerts-badge")
    ).not.toBeInTheDocument();
  });

  it("never polls the alerts rollup", async () => {
    render(<CoordNav />);
    await waitFor(() => expect(httpGet).toHaveBeenCalled());
    expect(
      httpGet.mock.calls.filter((call) =>
        String(call[0]).startsWith("/api/v1/operations/alerts")
      )
    ).toHaveLength(0);
  });

  it("renders no badge when the reads are unavailable", async () => {
    httpGet.mockRejectedValue(new Error("boom"));
    render(<CoordNav />);

    await waitFor(() => expect(httpGet).toHaveBeenCalled());
    expect(
      screen.queryByTestId("coord-nav-notifications-badge")
    ).not.toBeInTheDocument();
  });

  describe("polling is gated on tab visibility", () => {
    /**
     * The nav renders on every console page, so its badges are the
     * widest-reach pollers in the app. `RedMainBanner` gates its one poller;
     * this nav was once the only one still ticking behind a hidden tab.
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
      httpGet.mockResolvedValue({ notifications: [], unread_count: 3 });
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
      httpGet.mockResolvedValue({ notifications: [], unread_count: 3 });
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
        return Promise.resolve({});
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
        return Promise.resolve({});
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
        return Promise.resolve({});
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
        return Promise.resolve({});
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
        return Promise.resolve({});
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
          return Promise.resolve({});
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
          return Promise.resolve({});
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
      // The sibling Dev Ops link is unaffected by the notifications failure.
      expect(screen.getByTestId("coord-nav-devops-alarm")).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // The fleet alarm on the Dev Ops link — Verification 7.
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

    /** Route the nav's three reads: notifications, health, samples. */
    function routeFleet(health: unknown, samples: unknown) {
      httpGet.mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes("fleet/resource-samples"))
          return Promise.resolve(samples);
        if (u.includes("fleet/health")) return Promise.resolve(health);
        if (u.startsWith("/api/v1/operations/notifications")) {
          return Promise.resolve({ notifications: [], unread_count: 0 });
        }
        return Promise.resolve({});
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

      const trigger = screen.getByTestId("coord-nav-devops-alarm");
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
      const trigger = screen.getByTestId("coord-nav-devops-alarm");
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
      expect(screen.getByTestId("coord-nav-devops-alarm")).toHaveTextContent(
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
        return Promise.resolve({});
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
        return Promise.resolve({});
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
        return Promise.resolve({});
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
        return Promise.resolve({});
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
        return Promise.resolve({});
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
