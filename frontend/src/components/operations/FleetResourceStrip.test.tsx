/**
 * FleetResourceStrip — the §C3 honesty rules as RENDERED output.
 *
 * `fleetResources.test.ts` pins the predicates; this pins that the table
 * actually shows what they decide. The three that matter most are the states
 * this surface will spend most of its life in before the publishers land:
 * `schema_pending`, no-sample, and stale.
 *
 * The poll is injected (the strip takes its `resources` as a prop, as
 * `DeviceStatusTile` takes its stream), so no network is involved.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { FleetResourceStrip } from "./FleetResourceStrip";
import type {
  ResourceSampleRow,
  ResourceSamplesResponse,
} from "./fleetResources";
import type { UseFleetResourceSamplesResult } from "./useFleetResourceSamples";

const GIB = 1024 ** 3;
const DEV = "11111111-1111-1111-1111-111111111111";

function sample(overrides: Partial<ResourceSampleRow> = {}): ResourceSampleRow {
  return {
    device_id: DEV,
    lane: "host",
    lane_instance: null,
    sampled_at: "2026-08-06T12:00:00Z",
    age_secs: 15,
    cpu_cores: 16,
    load_1m: null,
    mem_total_bytes: 32 * GIB,
    mem_available_bytes: 4 * GIB,
    commit_total_bytes: 64 * GIB,
    commit_available_bytes: 13 * GIB,
    swap_total_bytes: null,
    swap_used_bytes: null,
    disk_total_bytes: 1000 * GIB,
    disk_free_bytes: 100 * GIB,
    disk_mount: "D:",
    build_slots_total: 4,
    build_slots_busy: 1,
    build_queue_depth: 0,
    ci_jobs_running: null,
    source: "supervisor",
    pressure: { ratio: 0.8, basis: "commit" },
    ...overrides,
  };
}

function renderStrip(
  data: ResourceSamplesResponse | null,
  {
    devices = [{ device_id: DEV, hostname: "msi" }],
    error = null,
  }: {
    devices?: { device_id: string; hostname?: string }[];
    error?: string | null;
  } = {}
) {
  const resources: UseFleetResourceSamplesResult = {
    data,
    loading: false,
    error,
    fetchedAtMs: Date.now(),
    refresh: vi.fn(),
  };
  return render(<FleetResourceStrip devices={devices} resources={resources} />);
}

describe("§C3 — no recent sample renders unknown, never healthy", () => {
  it("renders the machine with an explicit unknown lead column", () => {
    renderStrip({ latest: [], history: [] });
    const rows = screen.getAllByTestId("fleet-resource-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-freshness")).toBe("unknown");
    expect(
      within(rows[0]).getByTestId("fleet-resource-pressure-unknown")
    ).toBeTruthy();
    // The word "healthy" must not appear anywhere on an unmeasured machine.
    expect(rows[0].textContent).not.toMatch(/healthy/i);
  });

  it("says so when coord reports schema_pending, rather than showing an idle fleet", () => {
    renderStrip({ latest: [], history: [], schema_pending: true });
    const banner = screen.getByTestId("fleet-resource-schema-pending");
    expect(banner.textContent).toMatch(/unknown/);
    expect(banner.textContent).toMatch(/not the same as/i);
  });

  it("warns that rows are last-known when the proxy itself failed", () => {
    renderStrip({ latest: [sample()], history: [] }, { error: "502" });
    expect(screen.getByTestId("fleet-resource-error").textContent).toMatch(
      /last-known, not\s+current/i
    );
  });

  it("renders unknown — not 0 and not green — when the server has no pressure opinion", () => {
    renderStrip({ latest: [sample({ pressure: null })], history: [] });
    expect(
      screen.getByTestId("fleet-resource-pressure-no-opinion")
    ).toBeTruthy();
    expect(screen.queryByTestId("fleet-resource-pressure")).toBeNull();
  });
});

describe("§C3 — a stale sample renders as stale", () => {
  it("badges the row stale and strikes the value rather than showing it as current", () => {
    renderStrip({ latest: [sample({ age_secs: 600 })], history: [] });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-freshness")).toBe("stale");
    expect(
      within(row).getByTestId("fleet-resource-stale-badge").textContent
    ).toMatch(/stale/);
    // The lead column keeps the unknown dot tone, not a green one.
    const value = within(row).getByTestId("fleet-resource-pressure");
    expect(value.querySelector(".line-through")).toBeTruthy();
  });
});

describe("§C1 — the lead column says which metric it is", () => {
  it("labels a host row commit and a wsl row swap, on the same table", () => {
    renderStrip({
      latest: [
        sample(),
        sample({
          lane: "wsl",
          swap_total_bytes: 8 * GIB,
          swap_used_bytes: 2 * GIB,
          commit_total_bytes: null,
          commit_available_bytes: null,
          pressure: { ratio: 0.25, basis: "swap" },
        }),
      ],
      history: [],
    });
    expect(screen.getByText("commit used")).toBeTruthy();
    expect(screen.getByText("swap used")).toBeTruthy();
  });

  it("never prints a swap figure on a host row", () => {
    // A publisher bug: swap columns present on a Windows host row. The strip
    // must still not render them — on Windows they are the commit counters
    // printed a second time.
    renderStrip({
      latest: [
        sample({ swap_total_bytes: 40 * GIB, swap_used_bytes: 31 * GIB }),
      ],
      history: [],
    });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-lane")).toBe("host");
    expect(row.textContent).not.toMatch(/swap/i);
  });
});

describe("§C3 — the WSL lane's headroom is shown coupled to the host", () => {
  it("shows the spendable figure, host-bound, in the literal 2026-08-02 state", () => {
    renderStrip({
      latest: [
        // Host at 900 MB free commit.
        sample({ commit_available_bytes: 900 * 1024 * 1024 }),
        // WSL claiming 9 GB free.
        sample({
          lane: "wsl",
          mem_total_bytes: 16 * GIB,
          mem_available_bytes: 9 * GIB,
          commit_total_bytes: null,
          commit_available_bytes: null,
          swap_total_bytes: 8 * GIB,
          swap_used_bytes: 6 * GIB,
          pressure: { ratio: 0.75, basis: "swap" },
        }),
      ],
      history: [],
    });
    const coupled = screen.getByTestId("fleet-resource-coupled-headroom");
    expect(coupled.textContent).toMatch(/900 MB/);
    expect(coupled.textContent).toMatch(/host-bound/);
  });

  it("says the coupled figure is unknown when no host lane reported", () => {
    renderStrip({
      latest: [
        sample({
          lane: "wsl",
          mem_available_bytes: 9 * GIB,
          commit_total_bytes: null,
          commit_available_bytes: null,
          swap_total_bytes: 8 * GIB,
          swap_used_bytes: 1 * GIB,
          pressure: { ratio: 0.125, basis: "swap" },
        }),
      ],
      history: [],
    });
    expect(
      screen.getByTestId("fleet-resource-coupled-headroom").textContent
    ).toMatch(/coupled: unknown/);
  });
});

describe("§C3 — the effective floors, with defer vs reject", () => {
  it("shows both verdicts and marks the numbers as documented constants", () => {
    renderStrip({ latest: [sample()], history: [] });
    const floors = screen.getByTestId("fleet-resource-floors");
    expect(floors.textContent).toMatch(/defers/);
    expect(floors.textContent).toMatch(/rejects/);
    expect(floors.textContent).toMatch(/not live per-device state/i);
  });
});

describe("sparklines", () => {
  it("draws a trend when the window has usable points", () => {
    renderStrip({
      latest: [sample()],
      history: [
        {
          device_id: DEV,
          lane: "host",
          lane_instance: null,
          pressure_basis: "commit",
          points: [
            {
              sampled_at: "2026-08-06T11:59:00Z",
              pressure: 0.4,
              disk_free_bytes: null,
              disk_total_bytes: null,
              build_slots_busy: null,
              build_slots_total: null,
              ci_jobs_running: null,
            },
            {
              sampled_at: "2026-08-06T12:00:00Z",
              pressure: 0.8,
              disk_free_bytes: null,
              disk_total_bytes: null,
              build_slots_busy: null,
              build_slots_total: null,
              ci_jobs_running: null,
            },
          ],
        },
      ],
    });
    expect(screen.getByTestId("fleet-resource-sparkline")).toBeTruthy();
  });

  it("says 'no history' rather than drawing a chart from one point", () => {
    renderStrip({ latest: [sample()], history: [] });
    expect(screen.getByTestId("fleet-resource-sparkline-empty")).toBeTruthy();
  });
});

describe("§C3 — staleness applies to the WHOLE row, not just the lead column", () => {
  it("withholds disk / slots / CI jobs / memory on an unknown row", () => {
    // Older than EXPIRED_AFTER_SECS: the row is unknown, so no cell may print
    // a value as if it were current.
    renderStrip({ latest: [sample({ age_secs: 40_000 })], history: [] });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-freshness")).toBe("unknown");
    // The disk figure from the sample must not appear.
    expect(row.textContent).not.toMatch(/100 GB/);
    expect(row.textContent).not.toMatch(/1\/4/);
  });

  it("shows stale values demoted rather than withheld", () => {
    renderStrip({ latest: [sample({ age_secs: 600 })], history: [] });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-freshness")).toBe("stale");
    // Still readable as "last known"…
    expect(row.textContent).toMatch(/100 GB/);
    // …but visibly demoted.
    expect(row.querySelectorAll(".italic.opacity-60").length).toBeGreaterThan(
      0
    );
  });
});

describe("§C1 — a host row never prints swap counters, even if coord says swap", () => {
  it("suppresses the raw swap disclosure when the lane is host", () => {
    // A publisher/coord bug: basis=swap stamped on a host lane. The ratio is
    // still the server's, but the counters must not be printed a second time
    // under a swap label.
    renderStrip({
      latest: [
        sample({
          lane: "host",
          swap_total_bytes: 40 * GIB,
          swap_used_bytes: 31 * GIB,
          pressure: { ratio: 0.775, basis: "swap" },
        }),
      ],
      history: [],
    });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-lane")).toBe("host");
    // The visible label falls back to the honest instrument for this lane.
    expect(within(row).getByText("commit used")).toBeTruthy();
    expect(within(row).queryByText("swap used")).toBeNull();
  });
});

describe("§C1 — the coupled WSL figure carries its ceiling", () => {
  it("never prints a bare byte count for spendable headroom", () => {
    renderStrip({
      latest: [
        sample({ commit_available_bytes: 900 * 1024 * 1024 }),
        sample({
          lane: "wsl",
          mem_total_bytes: 16 * GIB,
          mem_available_bytes: 9 * GIB,
          commit_total_bytes: 64 * GIB,
          commit_available_bytes: null,
          swap_total_bytes: 8 * GIB,
          swap_used_bytes: 6 * GIB,
          pressure: { ratio: 0.75, basis: "swap" },
        }),
      ],
      history: [],
    });
    const coupled = screen.getByTestId("fleet-resource-coupled-headroom");
    // A denominator and a percentage, not "spendable: 900 MB" on its own.
    expect(coupled.textContent).toMatch(/\//);
    expect(coupled.textContent).toMatch(/%/);
    expect(coupled.textContent).toMatch(/host-bound/);
  });
});
