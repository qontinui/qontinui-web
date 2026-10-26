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
  runs: (url: string) => Answer;
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
        answer = routes.runs(url);
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

  it("an open run is listed as open, with its time so far", async () => {
    routes.runs = () => ({
      body: runListFx([
        runFx({
          ended_at: null,
          wall_seconds: null,
          end_source: null,
          end_reason: null,
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
