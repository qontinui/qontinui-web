/**
 * FleetResourcesSection — the Dev Ops page's mount of the fleet strip.
 *
 * `/admin/coord/devops` renders this section, not the strip directly, so this
 * is where the operator's view enters. It pins that a Linux host's served
 * `swap_ratio` reaches the page through the section's own poll, with the hook
 * mocked so no network is involved.
 *
 * Plan: `2026-11-09-devops-swap-axis-did-not-surface-tmpfs-exhaustion-on-nilan`
 * Phase 2.
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

const resources: UseFleetResourceSamplesResult = {
  data: { latest: [nilanHost], history: [] } as never,
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
});
