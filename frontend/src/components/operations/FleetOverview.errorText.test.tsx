/**
 * FleetOverview's `/fleet` error wording. A non-2xx and a transport failure
 * are "Operations API unreachable: …"; a 2xx whose body does not parse is
 * NOT unreachable — it fails the refresh with the parse error's own message,
 * as it did before the read moved onto the typed client (`fetchFleetStatus`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

// The component's other feeds are out of scope here: each has its own tests,
// and stubbing them keeps this suite to the two reads it is about.
vi.mock("./useFleetVolumes", () => ({
  useFleetVolumes: () => ({ state: "loading" }),
}));
vi.mock("./useSymbolClaimsStream", () => ({
  useSymbolClaimsStream: () => ({
    claims: [],
    loading: true,
    error: null,
    connected: false,
  }),
}));

import { FleetOverview } from "./FleetOverview";

function Host(): ReactElement {
  const noop = async () => {};
  return (
    <FleetOverview
      health={{
        data: null,
        loading: false,
        error: null,
        asOfMs: null,
        refresh: noop,
      }}
      ciMachines={{ state: "loading" }}
      drain={{ read: { state: "loading" }, asOfMs: null, refresh: noop }}
      deviceStatus={{
        byHostname: new Map(),
        connected: false,
        error: null,
        seeded: false,
        everSeeded: false,
        refetch: noop,
      }}
      nowMs={0}
      ciRunnerMirror={{ state: "loading" }}
    />
  );
}

function route(fleet: () => Response) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/v1/operations/fleet") return fleet();
    if (url === "/api/v1/operations/fleet/tasks")
      return new Response(JSON.stringify({ task_runs: [], total: 0 }));
    return new Response("{}");
  });
}

function routeTasks(tasks: unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/v1/operations/fleet/tasks")
      return new Response(JSON.stringify(tasks));
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
    return new Response("{}");
  });
}

describe("FleetOverview withheld runners", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("says when the backend declined to dial a runner, rather than showing no tasks", async () => {
    routeTasks({ task_runs: [], total: 0, withheld_co_located: 2 });
    render(<Host />);
    const note = await screen.findByTestId("fleet-tasks-withheld");
    expect(note.textContent).toContain("limited to platform administrators");
    expect(note.textContent).toContain(
      "2 runner beacons under your hosts give this server's own address"
    );
  });

  it.each([
    ["none was withheld", { task_runs: [], total: 0, withheld_co_located: 0 }],
    ["the backend predates the field", { task_runs: [], total: 0 }],
  ])("says nothing when %s", async (_name, tasks) => {
    routeTasks(tasks);
    render(<Host />);
    await screen.findAllByText(/Running Tasks/);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/operations/fleet/tasks",
        expect.anything()
      )
    );
    expect(screen.queryByTestId("fleet-tasks-withheld")).toBeNull();
  });
});

describe("FleetOverview /fleet error wording", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("shows a 2xx with an unparseable body as the parse error, not as unreachable", async () => {
    route(() => new Response("<html>", { status: 200 }));
    render(<Host />);
    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();
    expect(screen.queryByText(/Operations API unreachable/)).toBeNull();
  });

  it("shows a non-2xx as Operations API unreachable: HTTP <status>", async () => {
    route(() => new Response("down", { status: 503 }));
    render(<Host />);
    expect(
      await screen.findByText("Operations API unreachable: HTTP 503")
    ).toBeInTheDocument();
  });
});
