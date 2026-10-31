/**
 * /admin/coord/spawns — rendered.
 *
 * Plan `2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration`
 * Phase 5, and the UX pass that moved the per-request list and the per-device
 * placement to the investigation view (`requests/page.test.tsx` pins those).
 * Every route the page reads answers `{status, body}` here, so the failure arms
 * run through the real client, `classifySpawnError` and the hook's
 * rejected-read branches. What is pinned, and why each would go red:
 *
 * 1. **Real data renders**: the strip's figures with their window and as-of
 *    time, and the requests and their placement as COUNTS that link to the
 *    investigation view — no row, tab or per-device line on this page.
 * 2. **A request waiting from before the window is counted as queued**, and
 *    the strip goes red once it has waited a day.
 * 3. **A ledger coord does not serve is said ONCE**: `{available: false}` and
 *    the `no_such_route` 404 stand one notice in the strip's place, naming
 *    every section that rests on the ledger, and none of those renders — no
 *    strip, banner, count, chart, Last spawned or in-flight column. A read
 *    that FAILED collapses nothing.
 * 4. **A null share renders UNKNOWN**, never `0%`.
 * 5. **Backfilled rows are counted on the strip.**
 * 6. **An empty window is a measured empty**, with counts of `0`.
 * 7. **The failure arms**: a 403 clears the counts and says who may read; a
 *    `no_such_route` 404 is said once, as in 3; a 502 after
 *    a good read keeps the counts and says the refresh failed; a window list
 *    that fails leaves its counts at a dash, never 0.
 * 8. **Controls**: a refresh says when it re-read; switching the window
 *    re-reads stats and list; a truncated list draws a partial chart and says
 *    the counts cover the rows loaded.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/spawns",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

/** What each route answers; a test overrides the ones it is about. */
let routes: SpawnsRoutes = defaultSpawnsRoutes();
const calls: string[] = [];

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string, init?: RequestInit) => {
      calls.push(url);
      return answerSpawnsRequest(routes, url, init);
    },
  },
}));

import {
  answerSpawnsRequest,
  defaultSpawnsRoutes,
  type SpawnsRoutes,
} from "./__fixtures__/spawnsRoutes";
import {
  DEVICE_B,
  SCHEMA_MISSING,
  detailFx,
  eventFx,
  listFx,
  rowFx,
  statsFx,
} from "./__fixtures__/coordSpawns";
import { UNKNOWN_AMBER } from "@/components/console";
import { LEDGER_DEPENDENTS } from "./_components/LedgerUnservedNotice";
import { IN_FLIGHT_UNKNOWN } from "./_lib/machineStatus";
import CoordSpawnsPage from "./page";

/** Let every read in flight — including the poll's second, dependent step — land. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

async function renderPage() {
  render(<CoordSpawnsPage />);
  await settle();
}

/** A summary count as rendered: its number, or `unknown` for a dash. */
function countOf(id: string): string | null {
  return screen
    .getByTestId(`coord-spawns-count-${id}`)
    .getAttribute("data-count");
}

async function refresh() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("coord-spawns-refresh"));
  });
  await settle();
}

beforeEach(() => {
  calls.length = 0;
  routes = defaultSpawnsRoutes();
});

describe("/admin/coord/spawns — the ledger as coord serves it", () => {
  it("renders real data: the strip, the counts that link to the requests, and the launcher", async () => {
    const started = rowFx({ wait_seconds: 12 });
    const queued = rowFx({
      state: "queued",
      requested_at: new Date(Date.now() - 2 * 60_000).toISOString(),
      spawned_at: null,
      spawned_device_id: null,
      current_device_id: null,
      preferred_device_id: DEVICE_B,
      session_outcome: null,
      wait_seconds: null,
    });
    routes.list = () => ({ body: listFx([started, queued]) });
    routes.pending = () => ({ body: listFx([queued]) });
    await renderPage();

    const strip = screen.getByTestId("coord-spawns-health");
    expect(strip.textContent).toContain("2 spawns waiting to start");
    expect(strip.textContent).toContain("as of");
    expect(screen.getByTestId("coord-spawns-started-share").textContent).toBe(
      "started 97.4% of 38 ended requests"
    );
    expect(screen.getByTestId("coord-spawns-time-to-spawn").textContent).toBe(
      "time to spawn p50 12 s · p90 3.2 min"
    );
    expect(screen.getByTestId("coord-spawns-rates").textContent).toBe(
      "requested 0.24/h · started 0.22/h (40 requested · 37 started)"
    );
    expect(screen.getByTestId("coord-spawns-outcomes").textContent).toBe(
      "outcomes 30 finished · 4 working · 0 closed unfinished · 3 unknown"
    );
    expect(screen.getByTestId("coord-spawns-queued-now").textContent).toBe(
      "queued now 2"
    );

    // The requests and their placement are counts here; the list is the
    // investigation view's, one link away.
    expect(countOf("all")).toBe("2");
    expect(countOf("queued")).toBe("1");
    expect(countOf("failed")).toBe("0");
    expect(countOf("finished")).toBe("1");
    expect(countOf("placed")).toBe("38");
    expect(countOf("devices")).toBe("2");
    expect(
      screen.getByTestId("coord-spawns-requests-link").getAttribute("href")
    ).toBe("/admin/coord/spawns/requests?window=7d");
    expect(
      screen.getByTestId("coord-spawns-placement-link").getAttribute("href")
    ).toBe("/admin/coord/spawns/requests?window=7d#placement");
    // No per-request row, filter tab or per-device line on this page.
    expect(screen.queryAllByTestId("coord-spawn-row")).toHaveLength(0);
    expect(screen.queryByTestId("coord-spawns-filter-all")).toBeNull();
    expect(screen.queryAllByTestId("coord-spawns-device")).toHaveLength(0);

    const launch = screen.getByTestId("coord-spawns-launch-link");
    expect(launch.getAttribute("href")).toBe("/admin/coord/spawn");
    expect(launch.textContent).toContain("Launch session");
  });

  it("counts a request waiting from before the window as queued, and the strip goes red past a day", async () => {
    const old = rowFx({
      state: "deferred",
      deferrals: 43,
      requested_at: new Date(Date.now() - 3 * 24 * 3600_000).toISOString(),
      spawned_at: null,
      session_outcome: null,
      wait_seconds: null,
    });
    routes.list = () => ({ body: listFx([]) });
    routes.pending = () => ({
      body: listFx([old], { truncated: true, total: 340, shown: 1 }),
    });
    await renderPage();

    // Asked for with every waiting state, oldest first, and no `since`.
    const pendingCall = calls.find((u) => u.includes("state="));
    expect(pendingCall).toContain("state=queued%2Cdispatched%2Cdeferred");
    expect(pendingCall).toContain("order=asc");
    expect(pendingCall).not.toContain("since=");

    // The strip is never calmer than a row beneath it.
    const strip = screen.getByTestId("coord-spawns-health");
    expect(strip.getAttribute("data-health-level")).toBe("red");
    expect(strip.textContent).toContain("1 spawn stuck for 3 d");
    expect(countOf("queued")).toBe("1");
  });

  it("says once that the ledger is not deployed, and collapses every section that rests on it", async () => {
    routes.list = () => ({ body: SCHEMA_MISSING });
    routes.pending = () => ({ body: SCHEMA_MISSING });
    routes.stats = () => ({ body: SCHEMA_MISSING });
    await renderPage();

    const notice = screen.getByTestId("coord-spawns-ledger-unserved");
    expect(notice.getAttribute("data-issue")).toBe("ledger_not_deployed");
    expect(notice.textContent).toContain("Spawn ledger not deployed yet");
    expect(notice.textContent).toContain("unknown, not empty");
    expect(
      screen.getByTestId("coord-spawns-ledger-dependents").textContent
    ).toBe(
      `Until it is, this page does not show ${LEDGER_DEPENDENTS.join("; ")}. What is in flight on each machine against its ceiling is not shown either: ${IN_FLIGHT_UNKNOWN.operator}`
    );
    // Said once: no strip, no second banner, and no section of UNKNOWNs.
    expect(
      document.body.textContent?.match(/not deployed yet/g) ?? []
    ).toHaveLength(1);
    expect(screen.queryByTestId("coord-spawns-health")).toBeNull();
    expect(screen.queryByTestId("coord-spawns-unknown-banner")).toBeNull();
    expect(screen.queryByTestId("coord-spawns-requests-summary")).toBeNull();
    expect(screen.queryByTestId("coord-spawns-placement-summary")).toBeNull();
    expect(screen.queryByTestId("coord-spawns-rate-section")).toBeNull();
    // Nor a column of them: no Last spawned and no in-flight column.
    expect(screen.queryAllByTestId("coord-spawns-path-last")).toHaveLength(0);
    expect(screen.queryByText("Last spawned")).toBeNull();
    expect(screen.queryByTestId("coord-spawns-inflight-note")).toBeNull();
    expect(
      screen.queryAllByTestId("coord-spawns-machine-inflight")
    ).toHaveLength(0);
    // The sections that do not rest on the ledger still render.
    expect(
      screen.getAllByTestId("coord-spawns-path-row").length
    ).toBeGreaterThan(10);
    expect(screen.getAllByTestId("coord-spawns-machine")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("UNKNOWN UNKNOWN");
  });

  it("collapses nothing when a read FAILED: the ledger is served, and each section keeps its own arm", async () => {
    const down = { status: 502, body: { detail: "coord unreachable" } };
    routes.list = () => down;
    routes.pending = () => down;
    routes.stats = () => down;
    await renderPage();
    expect(screen.queryByTestId("coord-spawns-ledger-unserved")).toBeNull();
    expect(screen.getByTestId("coord-spawns-health")).toBeTruthy();
    expect(screen.getByTestId("coord-spawns-unknown-banner")).toBeTruthy();
    expect(countOf("all")).toBe("unknown");
    expect(
      screen.getAllByTestId("coord-spawns-path-last").length
    ).toBeGreaterThan(0);
  });

  it("renders a null share as UNKNOWN, never 0%", async () => {
    routes.stats = () => ({
      body: statsFx({
        requested: 3,
        terminal: 0,
        spawned: 0,
        cancelled: 0,
        started_share_bps: null,
        wait_p50_secs: null,
        wait_p90_secs: null,
        first_attempt_share_bps: null,
        queued_now: 3,
      }),
    });
    await renderPage();

    const share =
      screen.getByTestId("coord-spawns-started-share").textContent ?? "";
    expect(share).toBe("started share unknown (0 ended requests)");
    expect(share).not.toContain("0%");
    expect(screen.getByTestId("coord-spawns-time-to-spawn").textContent).toBe(
      "time to spawn p50 unknown · p90 unknown"
    );
    expect(screen.getByTestId("coord-spawns-first-attempt").textContent).toBe(
      "first attempt unknown (none started)"
    );
  });

  it("counts the backfilled rows whose history is partial on the strip", async () => {
    const backfilled = rowFx({
      history_complete: false,
      requested_at: "2026-10-21T11:00:00Z",
    });
    const recorded = rowFx({
      history_complete: true,
      requested_at: "2026-10-21T10:00:00Z",
    });
    routes.list = () => ({ body: listFx([backfilled, recorded]) });
    routes.stats = () => ({ body: statsFx({ history_partial_rows: 1 }) });
    routes.detail = () => ({
      body: detailFx(backfilled, [eventFx({ kind: "spawned" })]),
    });
    await renderPage();

    expect(screen.getByTestId("coord-spawns-history-partial").textContent).toBe(
      "history partial 1"
    );
  });

  it("counts only the devices that took a placement, and labels the count so", async () => {
    const good = statsFx();
    routes.stats = () => ({
      body: statsFx(
        {},
        {
          per_device: [
            ...good.per_device,
            {
              ...good.per_device[1]!,
              device_id: "host-c",
              placed: 0,
              started: 0,
            },
          ],
        }
      ),
    });
    await renderPage();
    expect(countOf("placed")).toBe("38");
    expect(countOf("devices")).toBe("2");
    expect(screen.getByTestId("coord-spawns-count-devices").textContent).toBe(
      "2devices with a placement"
    );
  });

  it("renders an empty window as a measured empty, with zero counts", async () => {
    routes.stats = () => ({
      body: statsFx(
        {
          requested: 0,
          terminal: 0,
          spawned: 0,
          cancelled: 0,
          started_share_bps: null,
          wait_p50_secs: null,
          wait_p90_secs: null,
          first_attempt_share_bps: null,
          requested_per_hour: 0,
          started_per_hour: 0,
          queued_now: 0,
          pending: { queued: 0, dispatched: 0, deferred: 0 },
        },
        { per_device: [] }
      ),
    });
    await renderPage();

    expect(screen.getByTestId("coord-spawns-health").textContent).toContain(
      "No spawn was requested in the last 7 days, and none is waiting"
    );
    expect(countOf("all")).toBe("0");
    expect(countOf("placed")).toBe("0");
    expect(countOf("devices")).toBe("0");
  });
});

describe("/admin/coord/spawns — the failure arms", () => {
  it("clears the counts and says who may read when the admin gate answers 403", async () => {
    routes.list = () => ({ body: listFx([rowFx()]) });
    await renderPage();

    const refused = {
      status: 403,
      body: { error: "FORBIDDEN", message: "not_coord_tenant_admin" },
    };
    routes.stats = () => refused;
    routes.list = () => refused;
    routes.pending = () => refused;
    await refresh();

    expect(screen.getByTestId("coord-spawns-health").textContent).toContain(
      "Coord tenant admins only"
    );
    expect(
      screen
        .getByTestId("coord-spawns-unknown-banner")
        .getAttribute("data-issue")
    ).toBe("forbidden");
    expect(countOf("all")).toBe("unknown");
  });

  it("says once that coord does not serve the ledger yet on its no_such_route 404", async () => {
    const notServed = { status: 404, body: { error: "no_such_route" } };
    routes.stats = () => notServed;
    routes.list = () => notServed;
    routes.pending = () => notServed;
    await renderPage();

    const notice = screen.getByTestId("coord-spawns-ledger-unserved");
    expect(notice.getAttribute("data-issue")).toBe("route_unavailable");
    expect(notice.textContent).toContain(
      "Coord does not serve the spawn ledger yet"
    );
    expect(screen.queryByTestId("coord-spawns-health")).toBeNull();
    expect(screen.queryByTestId("coord-spawns-unknown-banner")).toBeNull();
  });

  it("keeps the counts and says the refresh failed when a read after a good one answers 502", async () => {
    routes.list = () => ({ body: listFx([rowFx()]) });
    await renderPage();

    const down = { status: 502, body: { detail: "coord unreachable" } };
    routes.stats = () => down;
    routes.list = () => down;
    routes.pending = () => down;
    await refresh();

    const banner = screen.getByTestId("coord-spawns-unknown-banner");
    expect(banner.getAttribute("data-issue")).toBe("error");
    expect(banner.textContent).toContain("Last refresh failed");
    // Named for what this page shows from the retained list.
    expect(banner.textContent).toContain(
      "Last refresh failed — the counts below are from the last good read."
    );
    // The declared ignorance floor, never a hand-typed amber (§4.1).
    for (const cls of UNKNOWN_AMBER.split(" ")) {
      expect(banner.classList.contains(cls)).toBe(true);
    }
    expect(screen.getByTestId("coord-spawns-health").textContent).toContain(
      "Last refresh failed"
    );
    expect(countOf("all")).toBe("1");
  });

  it("gives the placement counts a dash, never 0, when a device's placed is not a number", async () => {
    const good = statsFx();
    routes.stats = () => ({
      body: statsFx(
        {},
        {
          per_device: [
            { ...good.per_device[0]!, placed: null as never },
            good.per_device[1]!,
          ],
        }
      ),
    });
    await renderPage();
    expect(countOf("placed")).toBe("unknown");
    expect(countOf("devices")).toBe("unknown");
  });

  it("gives the placement counts a dash, never 0, when the stats answer carries no per-device list", async () => {
    const { per_device: _dropped, ...noPerDevice } = statsFx();
    routes.stats = () => ({ body: noPerDevice });
    await renderPage();
    expect(countOf("placed")).toBe("unknown");
    expect(countOf("devices")).toBe("unknown");
  });

  it("says the placement counts are at the last good read when only the stats refresh fails", async () => {
    await renderPage();
    expect(screen.queryByTestId("coord-spawns-placement-stale")).toBeNull();

    routes.stats = () => ({
      status: 502,
      body: { detail: "coord unreachable" },
    });
    await refresh();

    expect(countOf("placed")).toBe("38");
    const stale = screen.getByTestId("coord-spawns-placement-stale");
    expect(stale.textContent).toContain("at the last good read");
    for (const cls of UNKNOWN_AMBER.split(" ")) {
      expect(stale.classList.contains(cls)).toBe(true);
    }
  });

  it("never says dashes are at the last good read when the stats read failed with nothing retained", async () => {
    routes.stats = () => ({
      status: 502,
      body: { detail: "coord unreachable" },
    });
    await renderPage();
    expect(countOf("placed")).toBe("unknown");
    expect(countOf("devices")).toBe("unknown");
    expect(screen.queryByTestId("coord-spawns-placement-stale")).toBeNull();
  });

  it("never says malformed placement counts are at the last good read when a refresh then fails", async () => {
    const good = statsFx();
    routes.stats = () => ({
      body: statsFx(
        {},
        {
          per_device: [
            { ...good.per_device[0]!, placed: null as never },
            good.per_device[1]!,
          ],
        }
      ),
    });
    await renderPage();
    routes.stats = () => ({
      status: 502,
      body: { detail: "coord unreachable" },
    });
    await refresh();
    expect(countOf("placed")).toBe("unknown");
    expect(screen.queryByTestId("coord-spawns-placement-stale")).toBeNull();
  });

  it("gives the window's counts a dash, never 0, when only the window's list fails", async () => {
    routes.list = () => ({
      status: 502,
      body: { detail: "coord unreachable" },
    });
    routes.pending = () => ({
      body: listFx([
        rowFx({
          state: "queued",
          requested_at: new Date(Date.now() - 60_000).toISOString(),
          spawned_at: null,
          spawned_device_id: null,
          session_outcome: null,
          wait_seconds: null,
        }),
      ]),
    });
    await renderPage();

    expect(countOf("all")).toBe("unknown");
    expect(countOf("queued")).toBe("1");
    expect(countOf("failed")).toBe("unknown");
    expect(countOf("never_ran")).toBe("unknown");
    expect(countOf("finished")).toBe("unknown");
  });
});

describe("/admin/coord/spawns — controls", () => {
  it("says when a refresh re-read the page, even when no read answered and every as-of is null", async () => {
    const down = () => ({ status: 502, body: { detail: "coord unreachable" } });
    for (const key of [
      "stats",
      "list",
      "pending",
      "fleet",
      "roles",
      "effective",
      "defaults",
      "nextStep",
      "merge",
      "repos",
      "drain",
      "concurrency",
    ] as const) {
      routes[key] = down;
    }
    await renderPage();
    expect(screen.queryByTestId("coord-spawns-reread")).toBeNull();
    const before = calls.length;
    await refresh();
    expect(calls.length).toBeGreaterThan(before);
    const reread = screen.getByTestId("coord-spawns-reread");
    expect(reread.textContent).toMatch(/^Re-read at \S/);
    expect(reread.getAttribute("role")).toBe("status");
  });

  it("re-reads stats and list for a new window, from coord's window_start", async () => {
    routes.stats = (url) => ({
      body: url.includes("window=24h")
        ? statsFx({}, { window: "24h", window_start: "2026-10-20T12:00:00Z" })
        : statsFx(),
    });
    await renderPage();
    expect(
      calls.some((u) => u.includes("since=2026-10-14T12%3A00%3A00Z"))
    ).toBe(true);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("coord-spawns-window"));
    await user.click(
      await screen.findByRole("option", { name: "last 24 hours" })
    );
    await settle();

    await waitFor(() =>
      expect(calls).toContain("/api/v1/operations/spawns/stats?window=24h")
    );
    expect(
      calls.some((u) => u.includes("since=2026-10-20T12%3A00%3A00Z"))
    ).toBe(true);
    expect(screen.getByTestId("coord-spawns-health").textContent).toContain(
      "last 24 hours"
    );
  });

  it("draws a truncated list as a partial chart, and says the counts cover the rows loaded", async () => {
    routes.list = () => ({
      body: listFx(
        [
          rowFx({
            requested_at: "2026-10-21T10:30:00Z",
            spawned_at: "2026-10-21T10:40:00Z",
          }),
          rowFx({
            requested_at: "2026-10-21T09:30:00Z",
            spawned_at: "2026-10-21T09:35:00Z",
          }),
        ],
        { truncated: true, total: 900, shown: 2 }
      ),
    });
    await renderPage();

    expect(screen.getByTestId("coord-spawns-count-truncated").textContent).toBe(
      "Counts cover the 2 most recent of 900 requests loaded."
    );
    const caption =
      screen.getByTestId("coord-spawns-rate-caption").textContent ?? "";
    expect(caption).toContain("Drawn from 10-21 10:00 UTC only");
    expect(caption).toContain("they are not zero");
    // Only the request made inside the span is drawn — the 09:30 one is not.
    const hours = screen.getAllByTestId("coord-spawns-rate-hour");
    expect(hours).toHaveLength(1);
    expect(hours[0]!.textContent).toBe("10-21 10:00 UTC11");
  });
});
