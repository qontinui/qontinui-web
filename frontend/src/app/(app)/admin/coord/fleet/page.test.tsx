/**
 * Component test for /admin/coord/fleet — HealthSummaryCard badge wiring.
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
import { render, screen, waitFor } from "@testing-library/react";

const httpGet = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
  },
}));

// The page composes two heavyweight operations components that fetch on
// mount; they are out of scope here (the badge wiring under test lives in
// HealthSummaryCard).
vi.mock("@/components/operations", () => ({
  DevActionsTile: () => null,
  FleetOverview: () => null,
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

describe("/admin/coord/fleet HealthSummaryCard", () => {
  beforeEach(() => {
    httpGet.mockReset();
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

    await waitFor(() => {
      expect(screen.getByText("unknown")).toBeInTheDocument();
    });
  });

  it("renders the empty state when no devices report health", async () => {
    httpGet.mockResolvedValue({ devices: [] });

    render(<CoordFleetPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/No devices reporting health/i),
      ).toBeInTheDocument();
    });
  });
});
