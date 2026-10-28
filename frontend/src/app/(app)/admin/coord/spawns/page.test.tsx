/**
 * /admin/coord/spawns — rendered.
 *
 * Plan `2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration`
 * Phase 5. Every route the page reads answers `{status, body}` here, so the
 * failure arms run through the real client, `classifySpawnError` and the
 * hook's rejected-read branches. What is pinned, and why each would go red:
 *
 * 1. **Real data renders**: the strip's figures with their window and as-of
 *    time, one line per device with its name and dispatch role, one row per
 *    request with its device, wait and outcome, and the expanded row's
 *    timeline from `GET /spawns/{id}`.
 * 2. **A request waiting from before the window is listed** — read oldest
 *    first, in the Queued tab, red once it has waited a day, and the strip
 *    goes red with it.
 * 3. **`{available: false}` is "spawn ledger not deployed yet"** on the strip,
 *    the list and the chart — never an empty ledger.
 * 4. **A null share renders UNKNOWN**, never `0%`.
 * 5. **A backfilled row is marked "history partial"**, and only that row.
 * 6. **An empty window is a measured empty**, with counts of `0`.
 * 7. **The failure arms**: a 403 from the admin gate clears the rows and says
 *    who may read; coord's `no_such_route` 404 says coord does not serve the
 *    ledger yet; a 502 after a good read keeps the rows and says the refresh
 *    failed; a window list that fails while the waiting read answers leaves
 *    the window's tabs at a dash with an UNKNOWN sentence, never "none"; a
 *    detail `spawn_not_found` says there is no such request.
 * 8. **Switching the window** re-reads stats and list for the new window; a
 *    **filter tab** has its own empty sentence; a **truncated list** draws a
 *    partial chart and a coverage line with its as-of.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  DEVICE_A,
  DEVICE_B,
  SCHEMA_MISSING,
  detailFx,
  eventFx,
  listFx,
  rowFx,
  statsFx,
} from "./__fixtures__/coordSpawns";
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
  it("renders real data: the strip, the per-device lines, the rows and a timeline", async () => {
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
    routes.detail = (id) => ({
      body: detailFx(id === started.id ? started : queued, [
        eventFx({ kind: "requested" }),
        eventFx({
          kind: "placed",
          device_id: DEVICE_A,
          at: "2026-10-21T11:00:01Z",
        }),
        eventFx({
          kind: "spawned",
          device_id: DEVICE_A,
          at: "2026-10-21T11:00:12Z",
        }),
      ]),
    });
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

    const devices = screen.getAllByTestId("coord-spawns-device");
    expect(devices[0]!.textContent).toContain("msi-wsl · Workhorse");
    expect(devices[0]!.textContent).toContain("30 placed");
    expect(devices[1]!.textContent).toContain("spaceship · Bench");
    expect(devices[1]!.textContent).toContain("p50 unknown");
    expect(
      screen.getByTestId("coord-spawns-reserve-note").textContent
    ).toContain("reserve and ceilings: not served yet");

    const rows = screen.getAllByTestId("coord-spawn-row");
    expect(rows).toHaveLength(2);
    const startedRow = rows.find((r) =>
      within(r)
        .getByTestId("coord-spawn-devices")
        .textContent?.includes("started on")
    )!;
    expect(
      within(startedRow)
        .getByTestId("coord-spawn-status")
        .getAttribute("data-status")
    ).toBe("work_completed");
    expect(
      within(startedRow).getByTestId("coord-spawn-devices").textContent
    ).toContain("started on msi-wsl");
    expect(within(startedRow).getByTestId("coord-spawn-wait").textContent).toBe(
      "started after 12 s"
    );

    expect(screen.getByTestId("coord-spawns-filter-all").textContent).toBe(
      "All2"
    );
    expect(screen.getByTestId("coord-spawns-filter-queued").textContent).toBe(
      "Queued1"
    );
    expect(screen.getByTestId("coord-spawns-filter-finished").textContent).toBe(
      "Finished1"
    );

    await act(async () => {
      fireEvent.click(within(startedRow).getByRole("button"));
    });
    await settle();
    const events = screen.getAllByTestId("coord-spawn-event");
    expect(events.map((e) => e.getAttribute("data-event-kind"))).toEqual([
      "requested",
      "placed",
      "spawned",
    ]);
    expect(events[1]!.textContent).toContain("msi-wsl");
    expect(calls).toContain(`/api/v1/operations/spawns/${started.id}`);

    const launch = screen.getByTestId("coord-spawns-launch-link");
    expect(launch.getAttribute("href")).toBe("/admin/coord/spawn");
    expect(launch.textContent).toContain("Launch session");
  });

  it("lists a request waiting from before the window in the Queued tab, red past a day", async () => {
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
    expect(screen.getByTestId("coord-spawns-coverage").textContent).toContain(
      "Plus the 1 oldest of 340 requests still waiting"
    );

    // The strip is never calmer than a row beneath it.
    const strip = screen.getByTestId("coord-spawns-health");
    expect(strip.getAttribute("data-health-level")).toBe("red");
    expect(strip.textContent).toContain("1 spawn stuck for 3 d");

    fireEvent.click(screen.getByTestId("coord-spawns-filter-queued"));
    const row = screen.getByTestId("coord-spawn-row");
    const badge = within(row).getByTestId("coord-spawn-status");
    expect(badge.getAttribute("data-status")).toBe("waiting_stuck");
    expect(within(row).getByRole("button").getAttribute("data-attention")).toBe(
      "author"
    );
  });

  it("says the spawn ledger is not deployed yet when coord answers available:false", async () => {
    routes.list = () => ({ body: SCHEMA_MISSING });
    routes.pending = () => ({ body: SCHEMA_MISSING });
    routes.stats = () => ({ body: SCHEMA_MISSING });
    await renderPage();

    const strip = screen.getByTestId("coord-spawns-health");
    expect(strip.textContent).toContain("Spawn ledger not deployed yet");
    expect(strip.getAttribute("data-health-level")).toBe("amber");
    const banner = screen.getByTestId("coord-spawns-unknown-banner");
    expect(banner.getAttribute("data-issue")).toBe("ledger_not_deployed");
    expect(banner.textContent).toContain("unknown, not empty");
    expect(screen.getByTestId("coord-spawns-list-unknown")).toBeTruthy();
    expect(screen.queryByTestId("coord-spawns-list-empty")).toBeNull();
    expect(screen.getByTestId("coord-spawns-devices-unknown")).toBeTruthy();
    expect(screen.getByTestId("coord-spawns-rate-chart-unknown")).toBeTruthy();
    // No count was read, so every tab is a dash — never 0.
    expect(screen.getByTestId("coord-spawns-filter-all").textContent).toBe(
      "All–"
    );
    expect(screen.getByTestId("coord-spawns-filter-failed").textContent).toBe(
      "Failed–"
    );
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

  it("marks a backfilled row history partial, and only that row", async () => {
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

    const [first, second] = screen.getAllByTestId("coord-spawn-row");
    expect(
      within(first!).getByTestId("coord-spawn-history-partial").textContent
    ).toBe("history partial");
    expect(
      within(second!).queryByTestId("coord-spawn-history-partial")
    ).toBeNull();
    expect(screen.getByTestId("coord-spawns-history-partial").textContent).toBe(
      "history partial 1"
    );

    await act(async () => {
      fireEvent.click(within(first!).getByRole("button"));
    });
    await settle();
    expect(
      screen.getByTestId("coord-spawn-history-partial-note").textContent
    ).toContain("timeline below is incomplete");
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
    expect(screen.getByTestId("coord-spawns-list-empty").textContent).toBe(
      "Coord recorded no spawn request in the last 7 days, and none older was waiting."
    );
    expect(screen.queryByTestId("coord-spawns-list-unknown")).toBeNull();
    expect(screen.getByTestId("coord-spawns-devices-empty")).toBeTruthy();
    expect(screen.getByTestId("coord-spawns-filter-all").textContent).toBe(
      "All0"
    );
    expect(screen.queryAllByTestId("coord-spawn-row")).toHaveLength(0);
  });
});

describe("/admin/coord/spawns — the failure arms", () => {
  it("clears the rows and says who may read when the admin gate answers 403", async () => {
    routes.list = () => ({ body: listFx([rowFx()]) });
    await renderPage();
    expect(screen.getAllByTestId("coord-spawn-row")).toHaveLength(1);

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
    expect(screen.queryAllByTestId("coord-spawn-row")).toHaveLength(0);
    expect(screen.getByTestId("coord-spawns-list-unknown")).toBeTruthy();
  });

  it("says coord does not serve the ledger yet on its no_such_route 404", async () => {
    const notServed = { status: 404, body: { error: "no_such_route" } };
    routes.stats = () => notServed;
    routes.list = () => notServed;
    routes.pending = () => notServed;
    await renderPage();

    expect(screen.getByTestId("coord-spawns-health").textContent).toContain(
      "Coord does not serve the spawn ledger yet"
    );
    const banner = screen.getByTestId("coord-spawns-unknown-banner");
    expect(banner.getAttribute("data-issue")).toBe("route_unavailable");
    expect(banner.textContent).toContain("does not serve the spawn ledger yet");
    expect(screen.getByTestId("coord-spawns-filter-all").textContent).toBe(
      "All–"
    );
  });

  it("keeps the rows and says the refresh failed when a read after a good one answers 502", async () => {
    routes.list = () => ({ body: listFx([rowFx()]) });
    await renderPage();

    const down = { status: 502, body: { detail: "coord unreachable" } };
    routes.stats = () => down;
    routes.list = () => down;
    routes.pending = () => down;
    await refresh();

    expect(screen.getAllByTestId("coord-spawn-row")).toHaveLength(1);
    const banner = screen.getByTestId("coord-spawns-unknown-banner");
    expect(banner.getAttribute("data-issue")).toBe("error");
    expect(banner.textContent).toContain("Last refresh failed");
    expect(screen.getByTestId("coord-spawns-health").textContent).toContain(
      "Last refresh failed"
    );
  });

  it("gives the window's tabs no count and no 'none' when only the window's list fails", async () => {
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

    const tab = (id: string) =>
      screen.getByTestId(`coord-spawns-filter-${id}`).textContent;
    expect(tab("all")).toBe("All–");
    expect(tab("queued")).toBe("Queued1");
    expect(tab("failed")).toBe("Failed–");
    expect(tab("never_ran")).toBe("Never ran–");
    expect(tab("finished")).toBe("Finished–");
    expect(screen.getByTestId("coord-spawns-coverage").textContent).toContain(
      "The requests in the last 7 days could not be read; only requests still waiting are listed."
    );

    fireEvent.click(screen.getByTestId("coord-spawns-filter-failed"));
    expect(screen.queryByTestId("coord-spawns-list-empty")).toBeNull();
    expect(screen.getByTestId("coord-spawns-list-unknown").textContent).toBe(
      "Coord's list of the requests in the last 7 days could not be read — which of them failed to start is unknown, not none."
    );

    // The waiting read DID answer, so the Queued tab still lists its row.
    fireEvent.click(screen.getByTestId("coord-spawns-filter-queued"));
    expect(screen.getAllByTestId("coord-spawn-row")).toHaveLength(1);
  });

  it("says there is no such request when a detail answers spawn_not_found", async () => {
    const row = rowFx();
    routes.list = () => ({ body: listFx([row]) });
    routes.detail = () => ({ status: 404, body: { error: "spawn_not_found" } });
    await renderPage();

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("coord-spawn-row")).getByRole("button")
      );
    });
    await settle();
    const timeline = screen.getByTestId("coord-spawn-timeline-unknown");
    expect(timeline.getAttribute("data-issue")).toBe("not_found");
    expect(timeline.textContent).toContain("no such spawn request");
  });
});

describe("/admin/coord/spawns — controls", () => {
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

  it("gives a filter tab its own empty sentence", async () => {
    routes.list = () => ({ body: listFx([rowFx()]) });
    await renderPage();

    fireEvent.click(screen.getByTestId("coord-spawns-filter-failed"));
    expect(screen.getByTestId("coord-spawns-list-empty").textContent).toBe(
      "No request in the last 7 days failed to start."
    );
    fireEvent.click(screen.getByTestId("coord-spawns-filter-never_ran"));
    expect(screen.getByTestId("coord-spawns-list-empty").textContent).toBe(
      "No request in the last 7 days expired, was cancelled or was superseded."
    );
  });

  it("draws a truncated list as a partial chart, with a coverage line and its as-of", async () => {
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

    const coverage =
      screen.getByTestId("coord-spawns-coverage").textContent ?? "";
    expect(coverage).toContain("Showing the 2 most recent of 900 requests");
    expect(coverage).toContain("as of");
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
