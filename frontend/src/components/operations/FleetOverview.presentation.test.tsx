/**
 * `FleetOverview`'s empty states in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` Phase 7): an empty machine list and
 * an empty device-status list say what they mean, and nothing an outsider
 * cannot act on — no "connect a runner via Settings", no route agents post to.
 * The operator console keeps both.
 */

import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));
// The component's other feeds are out of scope here, as in
// `FleetOverview.errorText.test.tsx`.
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

import { FixedPresentationMode } from "@/components/presentation";
import { FleetOverview } from "./FleetOverview";

/** A fleet that answered, with nothing in it: no runner, no coord device. */
function routeEmptyFleet() {
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

function Host({ presenting }: { presenting: boolean }): ReactElement {
  const noop = async () => {};
  return (
    <FixedPresentationMode presenting={presenting}>
      <FleetOverview
        health={{
          data: { devices: [] },
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
    </FixedPresentationMode>
  );
}

describe("FleetOverview?present=1 — empty lists in plain words", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("says no runner is online, and nothing about where to connect one", async () => {
    routeEmptyFleet();
    render(<Host presenting />);
    const empty = await screen.findByTestId("coord-devops-machines-empty");
    expect(empty).toHaveTextContent("No runners online");
    expect(empty.textContent).not.toMatch(/Connect a runner|Settings/);
    expect(screen.getByTestId("device-status-empty")).toHaveTextContent(
      "No machine has reported what it is working on in the last hour."
    );
    expect(document.body.textContent).not.toMatch(/POST|\/coord\//);
  });

  it("(control) the operator is told where to connect one, and which route agents post to", async () => {
    routeEmptyFleet();
    render(<Host presenting={false} />);
    const empty = await screen.findByTestId("coord-devops-machines-empty");
    expect(empty).toHaveTextContent(/Connect a runner via Settings/);
    expect(screen.getByTestId("device-status-empty")).toHaveTextContent(
      "POST /coord/status"
    );
  });
});
