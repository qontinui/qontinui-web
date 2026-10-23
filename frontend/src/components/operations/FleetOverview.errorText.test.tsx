/**
 * FleetOverview's `/fleet` error wording. A non-2xx and a transport failure
 * are "Operations API unreachable: …"; a 2xx whose body does not parse is
 * NOT unreachable — it fails the refresh with the parse error's own message,
 * as it did before the read moved onto the typed client (`fetchFleetStatus`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
        fetchedAtMs: null,
        refresh: noop,
      }}
      ciMachines={{ state: "loading" }}
      drain={{ read: { state: "loading" }, refresh: noop }}
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
