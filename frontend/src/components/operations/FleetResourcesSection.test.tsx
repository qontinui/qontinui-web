/**
 * FleetResourcesSection — the Dev Ops page's mount of the fleet strip.
 *
 * `/admin/coord/devops` renders this section, not the strip directly, so this
 * is where the operator's view enters. It pins that a Linux host's served
 * `swap_ratio` reaches the page through the section's own poll, with the hook
 * mocked so no network is involved.
 *
 * Plan: `2026-11-09-devops-swap-axis-did-not-surface-tmpfs-exhaustion-on-nilan`
 * Phase 2, and its follow-up: the same host's swap TRAJECTORY on the row's
 * sparkline.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { ResourceSampleRow } from "./fleetResources";
import type { UseFleetResourceSamplesResult } from "./useFleetResourceSamples";

const GIB = 1024 ** 3;
const DEV = "4b426e2b-cc10-4870-80a5-524aaac70719";

// nilan on 2026-11-09: commit 0.815, swap exhausted, headroom set by swap.
const nilanHost = {
  device_id: DEV,
  lane: "host",
  lane_instance: null,
  sampled_at: new Date().toISOString(),
  age_secs: 15,
  cpu_cores: 64,
  load_1m: null,
  cpu_temp_c: null,
  mem_total_bytes: 503 * GIB,
  mem_available_bytes: 93 * GIB,
  commit_total_bytes: 503 * GIB,
  commit_available_bytes: 93 * GIB,
  swap_total_bytes: 51_565_817_856,
  swap_used_bytes: 51_561_738_240,
  swap_ratio: 0.9999,
  disk_total_bytes: 7000 * GIB,
  disk_free_bytes: 6500 * GIB,
  disk_mount: "/",
  build_slots_total: null,
  build_slots_busy: 0,
  build_queue_depth: null,
  ci_jobs_running: 0,
  source: "runner",
  pressure: { ratio: 0.815, basis: "commit" },
  pressure_floor: {
    basis: "swap_ratio",
    ratio: 0.5,
    source: "default",
    verdict: "defer",
    reject_ratio: null,
    reject_source: null,
  },
  headroom: "warn",
  headroom_source: { basis: "swap", volume: null, free_bytes: null },
} as unknown as ResourceSampleRow;

// A fixture shaped like nilan's climb, with ILLUSTRATIVE values (these are not
// readings: finding 3544f066 records that this route served no swap for that
// window), in the wire form coord serves since qontinui-coord#4202. Commit is
// nearly flat while swap climbs to exhaustion.
const nilanHistory = {
  device_id: DEV,
  lane: "host",
  lane_instance: null,
  pressure_basis: "commit",
  points: [
    ["2026-11-09T18:00:00Z", 0.8, 0.62],
    ["2026-11-09T18:15:00Z", 0.81, 0.91],
    ["2026-11-09T18:30:00Z", 0.815, 0.9999],
  ].map(([sampled_at, pressure, swap_ratio]) => ({
    sampled_at,
    pressure,
    swap_ratio,
    disk_free_bytes: null,
    disk_total_bytes: null,
    build_slots_busy: null,
    build_slots_total: null,
    ci_jobs_running: null,
  })),
};

const resources: UseFleetResourceSamplesResult = {
  data: { latest: [nilanHost], history: [nilanHistory] } as never,
  loading: false,
  error: null,
  fetchedAtMs: Date.now(),
  refresh: vi.fn(),
};

vi.mock("./useFleetResourceSamples", () => ({
  useFleetResourceSamples: () => resources,
}));

// The CI panel reads the same rows but is not what this test is about.
vi.mock("./CiRunPanel", () => ({ CiRunPanel: () => null }));

import { FleetResourcesSection } from "./FleetResourcesSection";

describe("FleetResourcesSection — a Linux host's swap reaches the Dev Ops page", () => {
  it("renders the served swap_ratio beside commit for a host row", () => {
    render(
      <FleetResourcesSection
        devices={[{ device_id: DEV, hostname: "nilan" }]}
      />
    );
    const row = screen.getByTestId("fleet-resource-row");
    const swap = within(row).getByTestId("fleet-resource-host-swap");
    expect(swap).toHaveTextContent("100%");
    expect(
      within(row).getByTestId("fleet-resource-pressure")
    ).toHaveTextContent("82%");
    expect(
      within(row).getByTestId("fleet-resource-headroom-source")
    ).toHaveTextContent("set by swap");
  });

  it("draws the host's swap climb as a second sparkline line beside commit", () => {
    // Plan Phase 2 follow-up: the sparkline used to plot only `pressure`
    // (commit on a host), so this trajectory never showed.
    render(
      <FleetResourcesSection
        devices={[{ device_id: DEV, hostname: "nilan" }]}
      />
    );
    const row = screen.getByTestId("fleet-resource-row");
    const chart = within(row).getByTestId("fleet-resource-sparkline");
    expect(chart.getAttribute("data-swap-line")).toBe("drawn");
    expect(
      chart.querySelectorAll("path.recharts-line-curve[stroke-dasharray]")
    ).toHaveLength(1);
  });
});
