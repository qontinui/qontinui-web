/**
 * `FleetOverview` → machine card: coord's per-lane `stale_lanes` reaches the
 * card through the same door the Dev Ops page uses (plan
 * `2026-11-04-devops-a-silent-wsl-lane-reads-healthy-because-freshness-is-graded-on-the-newest-lane`,
 * Done-when 5). This enters where the population enters: the
 * `/fleet/health` body the page hands `FleetOverview`, not `MachineCard`
 * props built by hand.
 */

import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));
// The card's operator controls (drain, worktree cap) read the session; this
// test is about the lane badge, so any operator identity will do.
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));
vi.mock("./useFleetVolumes", () => ({
  useFleetVolumes: () => ({ state: "loading" }),
}));
vi.mock("./useSymbolClaimsStream", () => ({
  useSymbolClaimsStream: () => ({
    byMachine: new Map(),
    error: null,
    refetch: vi.fn(),
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import type { FleetHealthDevice } from "@/lib/api/operations/coordFleet";
import { FleetOverview } from "./FleetOverview";

function routeEmptyRunnerFleet() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/v1/operations/fleet")
      return new Response(
        JSON.stringify({
          runners: [],
          claude_sessions: {},
          machine_display_names: {},
          total_runners: 0,
          total_healthy: 0,
          total_running_tasks: 0,
          total_claude_sessions: 0,
        })
      );
    if (url === "/api/v1/operations/fleet/tasks")
      return new Response(JSON.stringify({ task_runs: [], total: 0 }));
    return new Response("{}");
  });
}

function Host({ devices }: { devices: FleetHealthDevice[] }): ReactElement {
  const noop = async () => {};
  return (
    <TooltipProvider>
      <FleetOverview
        health={{
          data: { devices },
          loading: false,
          error: null,
          asOfMs: Date.now(),
          refresh: noop,
        }}
        ciMachines={{ state: "loading" }}
        drain={{ read: { state: "loading" }, asOfMs: null, refresh: noop }}
        deviceStatus={{
          byHostname: new Map(),
          connected: false,
          error: null,
          seeded: true,
          everSeeded: true,
          refetch: noop,
        }}
        nowMs={Date.now()}
        ciRunnerMirror={{ state: "loading" }}
      />
    </TooltipProvider>
  );
}

const nawa = (over: Partial<FleetHealthDevice>): FleetHealthDevice => ({
  device_id: "7a2e9b10-3c44-4d21-9a6e-1f0b8c5d2e33",
  hostname: "nawa",
  state: "stale",
  heartbeat_state: "healthy",
  newest_sample_age_secs: 24,
  stalest_sample_age_secs: 697,
  sample_stale_after_secs: 120,
  ...over,
});

function renderFleet(devices: FleetHealthDevice[]) {
  routeEmptyRunnerFleet();
  return render(<Host devices={devices} />).container;
}

describe("FleetOverview — per-lane sample freshness on the machine card", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("names the silent wsl lane coord served in stale_lanes", async () => {
    const c = renderFleet([
      nawa({
        stale_lanes: [{ lane: "wsl", lane_instance: "Ubuntu", age_secs: 697 }],
      }),
    ]);
    await vi.waitFor(() =>
      expect(
        c
          .querySelector("[data-operations-lane-freshness]")
          ?.getAttribute("data-operations-stale-lanes")
      ).toBe("wsl/Ubuntu")
    );
  });

  it("keeps a failed read (null) UNKNOWN through the join, never []", async () => {
    const c = renderFleet([nawa({ state: "healthy", stale_lanes: null })]);
    await vi.waitFor(() =>
      expect(
        c
          .querySelector("[data-operations-lane-freshness]")
          ?.getAttribute("data-operations-lane-freshness")
      ).toBe("unknown")
    );
    // Null must arrive as null, not as absent: the badge names a failed read.
    expect(
      c.querySelector("[data-operations-lane-freshness]")?.innerHTML ?? ""
    ).toMatch(/read failed/);
  });
});
