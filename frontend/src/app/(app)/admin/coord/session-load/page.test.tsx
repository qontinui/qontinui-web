/**
 * /admin/coord/session-load — rendered.
 *
 * Plan `2026-10-23-session-duration-by-work-type-and-per-device-session-load`
 * Phase 5. Every route the page reads answers `{status, body}` here, so the
 * failure arms run through the real client, `classifySessionLoadError` and
 * the hooks' rejected-read branches. What is pinned, and why each would go red:
 *
 * 1. **Real data renders**: the strip's figures with their units, one line per
 *    work type with its slot-hours, wall time and sparkline, one line per
 *    machine with open runs against its configured session budget, the trend
 *    sentence naming its method and window, the run list, and each section's
 *    as-of.
 * 2. **coord's `503 schema_missing` is "not deployed yet"** on the strip and in
 *    every section — never an empty fleet, never a 0.
 * 3. **A silent machine reads UNKNOWN**, not its recorded open-run count.
 * 4. **Drill-down**: "Show these runs" re-reads the run list filtered by that
 *    work type; a run's detail links its gate.
 * 5. **Short history withholds the crossing date** and says why.
 * 6. **A failed run list** is an UNKNOWN sentence with dashed tab counts.
 * 7. **The initiator filter** reaches coord on the first page and on every
 *    later one, and a drill-down clears it (the row drilled from counts every
 *    initiator).
 * 8. **A run says what its row would otherwise hide**: a finish it is still
 *    holding a slot past, a reconciled id, a large clock skew, and the facts
 *    its work type was classified from.
 * 9. **A page asked for before or during a refresh** never lands in the
 *    refreshed list.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/session-load",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

interface Answer {
  status?: number;
  body: unknown;
}

const routes: {
  statsByType: (url: string) => Answer;
  statsByDevice: (url: string) => Answer;
  concurrency: (url: string) => Answer;
  growth: (url: string) => Answer;
  runs: (url: string) => Answer | Promise<Answer>;
} = {
  statsByType: () => ({ body: {} }),
  statsByDevice: () => ({ body: {} }),
  concurrency: () => ({ body: {} }),
  growth: () => ({ body: {} }),
  runs: () => ({ body: {} }),
};
const calls: string[] = [];

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string) => {
      calls.push(url);
      let answer: Answer;
      if (url.startsWith("/api/v1/operations/session-runs/stats"))
        answer = url.includes("group_by=device")
          ? routes.statsByDevice(url)
          : routes.statsByType(url);
      else if (url.startsWith("/api/v1/operations/session-runs/concurrency"))
        answer = routes.concurrency(url);
      else if (url.startsWith("/api/v1/operations/session-runs/growth"))
        answer = routes.growth(url);
      else if (url.startsWith("/api/v1/operations/session-runs?"))
        answer = await routes.runs(url);
      else throw new Error(`unexpected fetch ${url}`);
      return new Response(JSON.stringify(answer.body), {
        status: answer.status ?? 200,
      });
    },
  },
}));

import {
  SCHEMA_MISSING,
  concurrencyFx,
  deviceFx,
  deviceStatsFx,
  growthFx,
  runFx,
  runListFx,
  statsFx,
} from "./__fixtures__/sessionLoad";
import CoordSessionLoadPage from "./page";

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

async function renderPage() {
  render(<CoordSessionLoadPage />);
  await settle();
}

async function pickOption(triggerTestId: string, name: string) {
  const trigger = screen.getByTestId(triggerTestId);
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole("option", { name }));
  });
}

function healthy() {
  routes.statsByType = () => ({ body: statsFx() });
  routes.statsByDevice = () => ({ body: deviceStatsFx() });
  routes.concurrency = () => ({ body: concurrencyFx() });
  routes.growth = () => ({ body: growthFx(10, (i) => 10 + i * 10) });
  routes.runs = () => ({ body: runListFx() });
}

beforeEach(() => {
  calls.length = 0;
  healthy();
});

describe("/admin/coord/session-load", () => {
  it("renders every section from coord's answers, each number with its unit", async () => {
    await renderPage();
    const strip = screen.getByTestId("coord-session-load-health");
    expect(strip.textContent).toContain(
      "14 runs in the last 7 days, holding 20 slot-h · 2 open now"
    );

    const types = screen.getAllByTestId("coord-session-load-type-row");
    expect(types).toHaveLength(2);
    expect(
      within(types[0]!).getByTestId("coord-session-load-type-label").textContent
    ).toBe("/vet-imp");
    expect(
      within(types[1]!).getByTestId("coord-session-load-type-slot").textContent
    ).toContain("8 slot-h");
    expect(
      within(types[1]!).getByTestId("coord-session-load-type-wall").textContent
    ).toBe("median 12 min · p90 1.5 h wall time (7 observed ends)");
    expect(
      within(types[1]!)
        .getByTestId("coord-session-load-type-spark")
        .getAttribute("data-points")
    ).toBe("10");

    const machine = screen.getByTestId("coord-session-load-machine-row");
    expect(
      within(machine).getByTestId("coord-session-load-machine-open").textContent
    ).toBe("5 open");
    expect(
      within(machine).getByTestId("coord-session-load-machine-budget")
        .textContent
    ).toContain("configured session budget 14");
    expect(
      within(machine).getByTestId("coord-session-load-machine-concurrency")
        .textContent
    ).toBe("peak 9 · p95 6 open runs over the last 7 days");

    const trend = screen.getByTestId("coord-session-load-trend");
    expect(trend.getAttribute("data-trend")).toBe("projection");
    expect(trend.textContent).toMatch(
      /linear extrapolation of the 7 complete days/
    );
    expect(
      screen.getByTestId("coord-session-load-available").textContent
    ).toMatch(/336 slot-h\/day/);

    expect(screen.getAllByTestId("coord-session-load-run-row")).toHaveLength(1);
    expect(
      screen.getByTestId("coord-session-load-types-as-of").textContent
    ).toMatch(/^as of /);
    expect(
      screen.getByTestId("coord-session-load-machines-as-of").textContent
    ).toMatch(/^as of /);
    expect(
      screen.getByTestId("coord-session-load-growth-as-of").textContent
    ).toMatch(/^as of /);
    expect(
      screen.getByTestId("coord-session-load-spawns-link").getAttribute("href")
    ).toBe("/admin/coord/spawns");
  });

  it("reads coord's 503 schema_missing as 'not deployed', never as an empty fleet", async () => {
    const missing = () => ({ status: 503, body: SCHEMA_MISSING });
    routes.statsByType = missing;
    routes.statsByDevice = missing;
    routes.concurrency = missing;
    routes.growth = missing;
    routes.runs = missing;
    await renderPage();
    expect(
      screen.getByTestId("coord-session-load-health").textContent
    ).toContain(
      "Session run record not deployed yet — session load is unknown"
    );
    for (const id of [
      "coord-session-load-types-issue",
      "coord-session-load-machines-issue",
      "coord-session-load-growth-issue",
      "coord-session-load-runs-issue",
    ]) {
      expect(screen.getByTestId(id).getAttribute("data-issue")).toBe(
        "not_deployed"
      );
    }
    expect(screen.getByTestId("coord-session-load-types-unknown")).toBeTruthy();
    expect(
      screen.getByTestId("coord-session-load-machines-unknown")
    ).toBeTruthy();
    expect(screen.getByTestId("coord-session-load-runs-unknown")).toBeTruthy();
    expect(screen.queryByTestId("coord-session-load-types-empty")).toBeNull();
    expect(
      screen.getByTestId("coord-session-load-runs-filter-all").textContent
    ).toContain("–");
  });

  it("a silent machine's open runs read UNKNOWN", async () => {
    routes.concurrency = () => ({
      body: concurrencyFx([deviceFx({ heartbeat_age_seconds: 7200 })]),
    });
    await renderPage();
    const machine = screen.getByTestId("coord-session-load-machine-row");
    expect(
      within(machine).getByTestId("coord-session-load-machine-open").textContent
    ).toBe("UNKNOWN");
    expect(
      within(machine)
        .getByTestId("coord-session-load-machine-status")
        .getAttribute("data-status")
    ).toBe("silent");
    expect(screen.getByTestId("coord-session-load-health").textContent).toMatch(
      /1 machine silent/
    );
  });

  it("drills from a work type into its runs, and a run links its gate", async () => {
    await renderPage();
    const pm = screen.getAllByTestId("coord-session-load-type-row")[1]!;
    await act(async () => {
      fireEvent.click(within(pm).getByRole("button", { expanded: false }));
    });
    calls.length = 0;
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-session-load-type-show-runs"));
    });
    await settle();
    const runCall = calls.find((c) =>
      c.startsWith("/api/v1/operations/session-runs?")
    );
    expect(runCall).toContain("work_type=post_merge");

    const run = screen.getByTestId("coord-session-load-run-row");
    await act(async () => {
      fireEvent.click(within(run).getByRole("button", { expanded: false }));
    });
    expect(
      screen
        .getByTestId("coord-session-load-run-link-gate")
        .getAttribute("href")
    ).toBe("/admin/coord/gates?gate=2d2c3b4a-0000-4000-8000-000000000002");
  });

  it("a run's spawn request link reads the page's clock to pick its window", async () => {
    // Started two hours before the page's own clock: the narrowest window
    // holding the start is 24 h, so the link opens the next wider, 7 d. A
    // row that read no clock (or a stale one) would land on 30 d.
    const started = new Date(Date.now() - 2 * 3600_000).toISOString();
    routes.runs = () => ({
      body: runListFx([runFx({ started_at: started })]),
    });
    await renderPage();
    const run = screen.getByTestId("coord-session-load-run-row");
    await act(async () => {
      fireEvent.click(within(run).getByRole("button", { expanded: false }));
    });
    const link = screen.getByTestId("coord-session-load-run-link-spawn");
    expect(link.getAttribute("href")).toBe(
      "/admin/coord/spawns/requests?window=7d"
    );
    expect(link.textContent).toBe("Find the spawn request");
  });

  it("an open run past its finish says so on the row; a run's session always links", async () => {
    routes.runs = () => ({
      body: runListFx([
        runFx({
          ended_at: null,
          wall_seconds: null,
          held_after_finish_seconds: null,
        }),
      ]),
    });
    await renderPage();
    const run = screen.getByTestId("coord-session-load-run-row");
    expect(
      within(run).getByTestId("coord-session-load-run-wall").textContent
    ).toMatch(/so far · finished .* ago, still holding its slot$/);
    await act(async () => {
      fireEvent.click(within(run).getByRole("button", { expanded: false }));
    });
    expect(
      screen
        .getByTestId("coord-session-load-run-link-session")
        .getAttribute("href")
    ).toBe("/sessions/1d2c3b4a-0000-4000-8000-000000000001");
    expect(
      screen.getByTestId("coord-session-load-run-detail").textContent
    ).toContain("spawn_origin=gate_continuation");
  });

  it("flags a reconciled id and a large clock skew in words, on the row and in its detail", async () => {
    routes.runs = () => ({
      body: runListFx([
        runFx({ bind_origin: "reconciled", clock_skew_seconds: 1200 }),
      ]),
    });
    await renderPage();
    const run = screen.getByTestId("coord-session-load-run-row");
    expect(
      within(run).getByTestId("coord-session-load-run-flag-reconciled")
        .textContent
    ).toBe("reconciled id");
    expect(
      within(run).getByTestId("coord-session-load-run-flag-clock_skew")
        .textContent
    ).toBe("clock skew 20 min");
    await act(async () => {
      fireEvent.click(within(run).getByRole("button", { expanded: false }));
    });
    expect(
      screen.getByTestId("coord-session-load-run-flag-detail-reconciled")
        .textContent
    ).toMatch(/may name a foreign session/);
  });

  it("a work type's detail names its median active time", async () => {
    await renderPage();
    const pm = screen.getAllByTestId("coord-session-load-type-row")[1]!;
    await act(async () => {
      fireEvent.click(within(pm).getByRole("button", { expanded: false }));
    });
    expect(
      screen.getByTestId("coord-session-load-type-active").textContent
    ).toBe("median 5 min (7 runs measured)");
  });

  it("a machine's detail names each work type's peak", async () => {
    await renderPage();
    const machine = screen.getByTestId("coord-session-load-machine-row");
    await act(async () => {
      fireEvent.click(within(machine).getByRole("button", { expanded: false }));
    });
    expect(
      screen.getByTestId("coord-session-load-machine-peak-types").textContent
    ).toMatch(/post-merge follow-up 7 · \/vet-imp 2 .*do not add up/);
    expect(
      screen.queryByTestId("coord-session-load-machine-peak-types-none")
    ).toBeNull();
  });

  it("a machine with no type open at a whole minute says so, beside its peak of 0", async () => {
    routes.concurrency = () => ({
      body: concurrencyFx([
        deviceFx({
          open_now: 0,
          peak: 0,
          p95: 0,
          series: [
            {
              bucket_start: "2026-10-26T10:00:00Z",
              source: "raw",
              total: { peak: 0, p95: 0 },
              by_work_type: {},
            },
          ],
        }),
      ]),
    });
    await renderPage();
    const machine = screen.getByTestId("coord-session-load-machine-row");
    await act(async () => {
      fireEvent.click(within(machine).getByRole("button", { expanded: false }));
    });
    expect(
      screen.getByTestId("coord-session-load-machine-peak-types-none")
        .textContent
    ).toMatch(/run under a minute that crosses no minute mark/);
    expect(
      screen.queryByTestId("coord-session-load-machine-peak-types")
    ).toBeNull();
  });

  it("a machine with a peak but no readable work type says unknown, not that none was open", async () => {
    routes.concurrency = () => ({
      body: concurrencyFx([
        deviceFx({
          series: [
            {
              bucket_start: "2026-10-26T10:00:00Z",
              total: { peak: 4, p95: 3 },
            },
          ],
        }),
      ]),
    });
    await renderPage();
    const machine = screen.getByTestId("coord-session-load-machine-row");
    await act(async () => {
      fireEvent.click(within(machine).getByRole("button", { expanded: false }));
    });
    expect(
      screen.getByTestId("coord-session-load-machine-peak-types-unknown")
        .textContent
    ).toMatch(/unknown, not zero/);
    expect(
      screen.queryByTestId("coord-session-load-machine-peak-types-none")
    ).toBeNull();
  });

  it("the initiator filter re-reads the runs server-side, and a drill-down clears it", async () => {
    await renderPage();
    calls.length = 0;
    await pickOption("coord-session-load-runs-initiator", "the runner itself");
    await settle();
    expect(
      calls.find((c) => c.startsWith("/api/v1/operations/session-runs?"))
    ).toContain("initiator=runner_local");

    const pm = screen.getAllByTestId("coord-session-load-type-row")[1]!;
    await act(async () => {
      fireEvent.click(within(pm).getByRole("button", { expanded: false }));
    });
    calls.length = 0;
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-session-load-type-show-runs"));
    });
    await settle();
    const drilled = calls.find((c) =>
      c.startsWith("/api/v1/operations/session-runs?")
    );
    expect(drilled).toContain("work_type=post_merge");
    expect(drilled).not.toContain("initiator=");
  });

  it("load-more keeps the initiator filter on the next page", async () => {
    routes.runs = () => ({
      body: runListFx([runFx()], { next_cursor: "c1", truncated: true }),
    });
    await renderPage();
    await pickOption("coord-session-load-runs-initiator", "operator");
    await settle();
    calls.length = 0;
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-session-load-runs-more"));
    });
    await settle();
    const next = calls.find((c) => c.includes("cursor=c1"));
    expect(next).toContain("initiator=operator");
  });

  it("a page asked for before a refresh is not appended to the refreshed list", async () => {
    let answerStale: (a: Answer) => void = () => {};
    routes.runs = (url) =>
      url.includes("cursor=c1")
        ? new Promise<Answer>((resolve) => {
            answerStale = resolve;
          })
        : {
            body: runListFx([runFx()], {
              next_cursor: "c1",
              truncated: true,
            }),
          };
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-session-load-runs-more"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-session-load-refresh"));
    });
    await settle();
    await act(async () => {
      answerStale({ body: runListFx([runFx({ id: "stale-page" })]) });
    });
    await settle();
    expect(screen.getAllByTestId("coord-session-load-run-row")).toHaveLength(1);
  });

  it("a page asked for during a refresh is not appended to the refreshed list either", async () => {
    const firstPage = {
      body: runListFx([runFx()], { next_cursor: "c1", truncated: true }),
    };
    let answerRefresh: (a: Answer) => void = () => {};
    let answerOlder: (a: Answer) => void = () => {};
    let refreshing = false;
    routes.runs = (url) => {
      if (url.includes("cursor=c1")) {
        return new Promise<Answer>((resolve) => {
          answerOlder = resolve;
        });
      }
      if (refreshing) {
        return new Promise<Answer>((resolve) => {
          answerRefresh = resolve;
        });
      }
      return firstPage;
    };
    await renderPage();
    refreshing = true;
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-session-load-refresh"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-session-load-runs-more"));
    });
    await settle();
    await act(async () => {
      answerRefresh(firstPage);
    });
    await settle();
    await act(async () => {
      answerOlder({ body: runListFx([runFx({ id: "stale-page" })]) });
    });
    await settle();
    expect(screen.getAllByTestId("coord-session-load-run-row")).toHaveLength(1);
    expect(
      screen.getByTestId("coord-session-load-runs-coverage").textContent
    ).toMatch(/^Showing the 1 most recent/);
  });

  it("withholds the crossing date when history is too short, and says why", async () => {
    routes.growth = () => ({ body: growthFx(3, () => 50) });
    await renderPage();
    const trend = screen.getByTestId("coord-session-load-trend");
    expect(trend.getAttribute("data-trend")).toBe("history_too_short");
    expect(trend.textContent).toMatch(
      /history too short to extrapolate: .*3 complete days recorded, 7 needed/
    );
  });

  it("a failed run list is unknown with dashed counts, not 'no runs'", async () => {
    routes.runs = () => ({
      status: 502,
      body: { detail: "coord unreachable" },
    });
    await renderPage();
    expect(
      screen
        .getByTestId("coord-session-load-runs-issue")
        .getAttribute("data-issue")
    ).toBe("error");
    expect(screen.getByTestId("coord-session-load-runs-unknown")).toBeTruthy();
    expect(screen.queryByTestId("coord-session-load-runs-empty")).toBeNull();
    expect(
      screen.getByTestId("coord-session-load-runs-filter-open").textContent
    ).toContain("–");
  });

  it("a resumed run is named by coord's run_seq; a first run is not", async () => {
    routes.runs = () => ({
      body: runListFx([runFx(), runFx({ id: "second", run_seq: 2 })]),
    });
    await renderPage();
    const rows = screen.getAllByTestId("coord-session-load-run-row");
    expect(
      within(rows[0]!).queryByTestId("coord-session-load-run-resumed")
    ).toBeNull();
    expect(
      within(rows[1]!).getByTestId("coord-session-load-run-resumed").textContent
    ).toContain("resumed (run 2)");
  });

  it("an empty window kept behind a failed refresh says it may be stale, with its date", async () => {
    routes.statsByType = () => ({ body: statsFx([]) });
    routes.concurrency = () => ({ body: concurrencyFx([]) });
    await renderPage();
    expect(
      screen.getByTestId("coord-session-load-types-empty").textContent
    ).not.toMatch(/last good read/);
    routes.statsByType = () => ({
      status: 502,
      body: { detail: "coord unreachable" },
    });
    routes.concurrency = () => ({
      status: 502,
      body: { detail: "coord unreachable" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-session-load-refresh"));
    });
    await settle();
    expect(
      screen.getByTestId("coord-session-load-types-empty").textContent
    ).toMatch(
      /at the last good read \(as of .+\) — the latest refresh failed, so this may be stale/
    );
    expect(
      screen.getByTestId("coord-session-load-machines-empty").textContent
    ).toMatch(/at the last good read \(as of .+\)/);
    const strip = screen.getByTestId("coord-session-load-health");
    expect(strip.textContent).toMatch(/Last refresh failed/);
  });

  it("an open run is listed as open, with its time so far", async () => {
    routes.runs = () => ({
      body: runListFx([
        runFx({
          ended_at: null,
          wall_seconds: null,
          end_source: null,
          end_reason: null,
          finished_at: null,
        }),
      ]),
    });
    await renderPage();
    const run = screen.getByTestId("coord-session-load-run-row");
    expect(
      within(run)
        .getByTestId("coord-session-load-run-status")
        .getAttribute("data-status")
    ).toBe("open");
    expect(
      within(run).getByTestId("coord-session-load-run-wall").textContent
    ).toMatch(/so far$/);
  });
});
