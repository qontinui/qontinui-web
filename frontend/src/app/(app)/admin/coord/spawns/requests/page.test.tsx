/**
 * /admin/coord/spawns/requests — the spawn requests investigation view,
 * rendered.
 *
 * The per-request list with its filters and the per-device placement moved here
 * from the agentic-activity page, which now shows their counts and links here
 * (UX pass, "features that should not exist"). Every test of the list and the
 * placement moved with them, unchanged in what it pins: real rows, a request
 * waiting from before the window, an undeployed ledger, a backfilled history,
 * a measured empty, the failure arms, and the controls. Added here: the
 * `?window=` the agentic-activity page links with, and that the view is in no
 * nav and is not presentation-ready.
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
  usePathname: () => "/admin/coord/spawns/requests",
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
} from "../__fixtures__/spawnsRoutes";
import {
  DEVICE_A,
  DEVICE_B,
  SCHEMA_MISSING,
  detailFx,
  eventFx,
  listFx,
  rowFx,
  statsFx,
} from "../__fixtures__/coordSpawns";
import { UNKNOWN_AMBER } from "@/components/console";
import { isPresentationReady } from "@/components/presentation";
import { windowFromQuery } from "../_lib/spawnRequestsRoute";
import CoordSpawnRequestsPage from "./page";

/** Let every read in flight — including the poll's second, dependent step — land. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

async function renderPage() {
  render(<CoordSpawnRequestsPage />);
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

describe("/admin/coord/spawns/requests — the ledger as coord serves it", () => {
  it("renders real data: the per-device lines, the rows and a timeline", async () => {
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

    const banner = screen.getByTestId("coord-spawns-unknown-banner");
    expect(banner.getAttribute("data-issue")).toBe("ledger_not_deployed");
    expect(banner.textContent).toContain("unknown, not empty");
    expect(screen.getByTestId("coord-spawns-list-unknown")).toBeTruthy();
    expect(screen.queryByTestId("coord-spawns-list-empty")).toBeNull();
    expect(screen.getByTestId("coord-spawns-devices-unknown")).toBeTruthy();
    // No count was read, so every tab is a dash — never 0.
    expect(screen.getByTestId("coord-spawns-filter-all").textContent).toBe(
      "All–"
    );
    expect(screen.getByTestId("coord-spawns-filter-failed").textContent).toBe(
      "Failed–"
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

    expect(screen.getByTestId("coord-spawns-list-empty").textContent).toBe(
      "No spawn request was recorded in the last 7 days, and none older was waiting."
    );
    expect(screen.queryByTestId("coord-spawns-list-unknown")).toBeNull();
    expect(screen.getByTestId("coord-spawns-devices-empty")).toBeTruthy();
    expect(screen.getByTestId("coord-spawns-filter-all").textContent).toBe(
      "All0"
    );
    expect(screen.queryAllByTestId("coord-spawn-row")).toHaveLength(0);
  });
});

describe("/admin/coord/spawns/requests — the failure arms", () => {
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
    // The declared ignorance floor, never a hand-typed amber (§4.1).
    for (const cls of UNKNOWN_AMBER.split(" ")) {
      expect(banner.classList.contains(cls)).toBe(true);
    }
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
      "The list of the requests in the last 7 days could not be read — which of them failed to start is unknown, not none."
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

describe("/admin/coord/spawns/requests — controls", () => {
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

  it("says a truncated list's coverage, with its as-of", async () => {
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
  });
});

describe("/admin/coord/spawns/requests — reached from the agentic-activity page", () => {
  it("opens on the window the link carried, and re-reads the list for a new one", async () => {
    window.history.replaceState(
      null,
      "",
      "/admin/coord/spawns/requests?window=24h"
    );
    try {
      await renderPage();
      expect(calls).toContain("/api/v1/operations/spawns/stats?window=24h");
      const user = userEvent.setup();
      await user.click(screen.getByTestId("coord-spawns-window"));
      await user.click(
        await screen.findByRole("option", { name: "last 30 days" })
      );
      await settle();
      await waitFor(() =>
        expect(calls).toContain("/api/v1/operations/spawns/stats?window=30d")
      );
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("ignores a window it does not offer", () => {
    expect(windowFromQuery("?window=24h")).toBe("24h");
    expect(windowFromQuery("?window=1y")).toBeNull();
    expect(windowFromQuery("")).toBeNull();
  });

  it("links back to the agentic-activity page", async () => {
    await renderPage();
    expect(
      screen.getByTestId("coord-spawn-requests-back").getAttribute("href")
    ).toBe("/admin/coord/spawns");
  });

  it("is an operator view: not presentation-ready, so the lens withholds it", () => {
    expect(isPresentationReady("/admin/coord/spawns/requests")).toBe(false);
  });
});
