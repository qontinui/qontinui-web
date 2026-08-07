/**
 * Component test for /admin/coord/fleet — HealthSummaryCard badge wiring +
 * the redesigned page structure (MergePipeline hero, System details demoted
 * and collapsed by default).
 *
 * Regression guard: coord's `GET /coord/fleet/health` serializes devices as
 * `{ state: "healthy" | "degraded" | "partitioned" | "abandoned" }` (Rust
 * `DeviceHealthSnapshot` with a serde-lowercase `DeviceState` enum). The page
 * previously read `d.status` — a key no producer serves — so every device
 * rendered as "unknown". This test feeds the real coord wire shape through a
 * mocked httpClient and asserts the badges show the coord states verbatim,
 * with no "unknown" fallback for devices that report a state.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const httpGet = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
  },
}));

// The page composes several heavyweight operations components that fetch on
// mount; they are out of scope here (the badge wiring under test lives in
// HealthSummaryCard). Stub every operations export the Fleet page imports —
// including the MergePipeline hero.
vi.mock("@/components/operations", () => ({
  DevActionsTile: () => null,
  FleetOverview: () => null,
  // Stubbed like the rest: the resource strip has its own render tests
  // (FleetResourceStrip.test.tsx). What matters HERE is that its alarm count
  // is hoisted onto the collapsed header, which the page computes itself.
  FleetResourcesSection: () => null,
  FleetTestTargetsPanel: () => null,
  MergePipeline: () => null,
  MergeDependencyGraph: () => null,
  CiStatusPanel: () => null,
  GatesPanel: () => null,
  MigrationQueueTile: () => null,
  LandedFeaturesPanel: () => null,
  StuckPrRecoveryPanel: () => null,
}));

import CoordFleetPage from "./page";

/** Coord wire shape — mirrors DeviceHealthSnapshot (fleet_health.rs). */
function coordDevice(id: string, hostname: string, state: string) {
  return {
    device_id: id,
    hostname,
    state,
    state_changed_at: "2026-06-12T00:00:00Z",
    last_probe_at: "2026-06-12T00:00:00Z",
    last_probe_ok: state === "healthy",
    consecutive_failures: state === "healthy" ? 0 : 3,
    agents_active: 0,
    updated_at: "2026-06-12T00:00:00Z",
  };
}

/** The System details section is collapsed (and unmounted) by default —
 *  open it so HealthSummaryCard renders. */
function openSystemDetails() {
  fireEvent.click(screen.getByText("System details"));
}

describe("/admin/coord/fleet page structure", () => {
  beforeEach(() => {
    httpGet.mockReset();
    window.localStorage.clear();
  });

  it("collapses System details by default while keeping the unhealthy count visible", async () => {
    httpGet.mockResolvedValue({
      devices: [
        coordDevice("d-1", "alpha", "healthy"),
        coordDevice("d-2", "bravo", "degraded"),
      ],
    });

    render(<CoordFleetPage />);

    // Alarm badge surfaces on the collapsed header (fetch is page-hoisted)…
    await waitFor(() => {
      expect(screen.getByText("1 unhealthy")).toBeInTheDocument();
    });
    // …but the detail rows are unmounted until the section is opened.
    expect(screen.queryAllByTestId("coord-fleet-health-row")).toHaveLength(0);

    openSystemDetails();
    await waitFor(() => {
      expect(screen.getAllByTestId("coord-fleet-health-row")).toHaveLength(2);
    });
  });
});

describe("/admin/coord/fleet HealthSummaryCard", () => {
  beforeEach(() => {
    httpGet.mockReset();
    window.localStorage.clear();
  });

  it("maps coord `state` values to badges with no 'unknown' fallback", async () => {
    httpGet.mockResolvedValue({
      devices: [
        coordDevice("d-1", "alpha", "healthy"),
        coordDevice("d-2", "bravo", "degraded"),
        coordDevice("d-3", "charlie", "partitioned"),
        coordDevice("d-4", "delta", "abandoned"),
      ],
      count: 4,
      by_state: { healthy: 1, degraded: 1, partitioned: 1, abandoned: 1 },
      alerts: { critical: 0, warning: 0, info: 0 },
    });

    render(<CoordFleetPage />);
    openSystemDetails();

    await waitFor(() => {
      expect(screen.getAllByTestId("coord-fleet-health-row")).toHaveLength(4);
    });

    // Every coord state renders verbatim on its row's badge.
    expect(screen.getByText("healthy")).toBeInTheDocument();
    expect(screen.getByText("degraded")).toBeInTheDocument();
    expect(screen.getByText("partitioned")).toBeInTheDocument();
    expect(screen.getByText("abandoned")).toBeInTheDocument();

    // No device with a reported state falls back to "unknown".
    expect(screen.queryByText("unknown")).not.toBeInTheDocument();

    // The fetch targeted the fleet/health proxy.
    expect(httpGet).toHaveBeenCalledWith("/api/v1/operations/fleet/health");
  });

  it("falls back to 'unknown' only when coord omits the state", async () => {
    httpGet.mockResolvedValue({
      devices: [{ device_id: "d-9", hostname: "echo" }],
    });

    render(<CoordFleetPage />);
    openSystemDetails();

    await waitFor(() => {
      expect(screen.getByText("unknown")).toBeInTheDocument();
    });
  });

  it("renders the empty state when no devices report health", async () => {
    httpGet.mockResolvedValue({ devices: [] });

    render(<CoordFleetPage />);
    openSystemDetails();

    await waitFor(() => {
      expect(
        screen.getByText(/No devices reporting health/i)
      ).toBeInTheDocument();
    });
  });
});

/**
 * §C1/§C3 — the resource alarm is hoisted onto the COLLAPSED header, for the
 * same reason the unhealthy count already is: a machine coord has stopped
 * electing is a red fleet state, and a red fleet state must not hide behind a
 * click. The count comes from coord's admission verdict, not from a
 * client-side band over the pressure ratio. That is
 * also why the poll lives on the page rather than inside the section (which
 * unmounts while collapsed).
 */
describe("/admin/coord/fleet resource alarm hoisting", () => {
  beforeEach(() => {
    httpGet.mockReset();
    window.localStorage.clear();
  });

  /** Route the two page-level GETs to different payloads. */
  function mockRoutes(health: unknown, samples: unknown) {
    httpGet.mockImplementation((url: unknown) =>
      typeof url === "string" && url.includes("resource-samples")
        ? Promise.resolve(samples)
        : Promise.resolve(health)
    );
  }

  function hostSample(
    deviceId: string,
    ratio: number,
    ageSecs = 15,
    headroom: "ok" | "warn" | "breach" | "unknown" | undefined = "ok"
  ) {
    return {
      device_id: deviceId,
      lane: "host",
      lane_instance: null,
      sampled_at: "2026-08-06T12:00:00Z",
      age_secs: ageSecs,
      cpu_cores: 16,
      load_1m: null,
      mem_total_bytes: 1,
      mem_available_bytes: 1,
      commit_total_bytes: 1,
      commit_available_bytes: 1,
      swap_total_bytes: null,
      swap_used_bytes: null,
      disk_total_bytes: 1,
      disk_free_bytes: 1,
      disk_mount: "D:",
      build_slots_total: 4,
      build_slots_busy: 1,
      build_queue_depth: 0,
      ci_jobs_running: null,
      source: "supervisor",
      pressure: { ratio, basis: "commit" },
      floor: {
        basis: "commit_available",
        bytes: 4 * 1024 ** 3,
        source: "default",
        verdict: "defer",
      },
      disk_floor: {
        basis: "disk_free",
        bytes: 30 * 1024 ** 3,
        source: "default",
        verdict: "reject",
      },
      headroom,
    };
  }

  it("shows the at-floor count on the collapsed header", async () => {
    mockRoutes(
      { devices: [coordDevice("d-1", "msi", "healthy")] },
      { latest: [hostSample("d-1", 0.95, 15, "breach")], history: [] }
    );

    render(<CoordFleetPage />);

    await waitFor(() => {
      expect(screen.getByTestId("coord-fleet-breach-badge")).toHaveTextContent(
        "1 refusing work"
      );
    });
    // Still collapsed — the alarm did not require opening the section.
    expect(screen.queryAllByTestId("coord-fleet-health-row")).toHaveLength(0);
  });

  it("raises no alarm from a high pressure ratio coord is still electing", async () => {
    // The defect this replaced: 0.95 was above the client-side SATURATED_AT,
    // so the header cried saturated while the dispatcher kept sending work.
    mockRoutes(
      { devices: [coordDevice("d-1", "msi", "healthy")] },
      { latest: [hostSample("d-1", 0.95, 15, "ok")], history: [] }
    );

    render(<CoordFleetPage />);

    await waitFor(() => {
      expect(screen.getByText("1 machines")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("coord-fleet-breach-badge")).toBeNull();
    expect(screen.queryByTestId("coord-fleet-unknown-badge")).toBeNull();
  });

  it("counts a lane coord reports no admission state for as unknown", async () => {
    // An older coord: the field is simply absent. Unknown, never healthy.
    const row = hostSample("d-1", 0.3, 15, undefined) as Record<
      string,
      unknown
    >;
    delete row.headroom;
    delete row.floor;
    delete row.disk_floor;
    mockRoutes(
      { devices: [coordDevice("d-1", "msi", "healthy")] },
      { latest: [row], history: [] }
    );

    render(<CoordFleetPage />);

    await waitFor(() => {
      expect(screen.getByTestId("coord-fleet-unknown-badge")).toHaveTextContent(
        "1 unknown"
      );
    });
    expect(screen.queryByTestId("coord-fleet-breach-badge")).toBeNull();
  });

  it("shows a stale count, and does NOT count a stale lane as breaching", async () => {
    mockRoutes(
      { devices: [coordDevice("d-1", "msi", "healthy")] },
      // Last known verdict was a breach, but the sample stopped being true.
      { latest: [hostSample("d-1", 0.99, 4000, "breach")], history: [] }
    );

    render(<CoordFleetPage />);

    await waitFor(() => {
      expect(screen.getByTestId("coord-fleet-stale-badge")).toHaveTextContent(
        "1 stale"
      );
    });
    expect(screen.queryByTestId("coord-fleet-breach-badge")).toBeNull();
  });

  it("raises no at-floor alarm when a machine has simply published nothing", async () => {
    // §C3: absence of signal is not health — but it is also not a red alarm.
    // It is unknown, and the header must not claim either.
    mockRoutes(
      { devices: [coordDevice("d-1", "msi", "healthy")] },
      { latest: [], history: [] }
    );

    render(<CoordFleetPage />);

    await waitFor(() => {
      expect(screen.getByText("1 machines")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("coord-fleet-breach-badge")).toBeNull();
    expect(screen.queryByTestId("coord-fleet-stale-badge")).toBeNull();
  });
});
