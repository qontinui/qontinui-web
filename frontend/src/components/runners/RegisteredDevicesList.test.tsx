/**
 * RegisteredDevicesList — per-device tenant binding chips.
 *
 * The binding set the web backend serves is tri-state, and each state must
 * render its own chip on the device row:
 *   null      → "bindings unknown" (UNKNOWN is never "none", never nothing)
 *   []        → "no tenant bindings"
 *   populated → one chip per binding, slug or id prefix, full id in the title
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RegisteredDevice } from "@/types/runner";

const getRunnersMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  runnerService: { getRunners: (...args: unknown[]) => getRunnersMock(...args) },
}));
vi.mock("@/hooks/useRealtimeConnections", () => ({
  useRealtimeConnections: () => ({ runners: [] }),
}));
vi.mock("@/hooks/useRunners", async () => {
  const actual =
    await vi.importActual<typeof import("@/hooks/useRunners")>(
      "@/hooks/useRunners"
    );
  return {
    ...actual,
    useDeleteRunner: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import { RegisteredDevicesList } from "./RegisteredDevicesList";

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function device(
  id: string,
  tenant_bindings: RegisteredDevice["tenant_bindings"]
): RegisteredDevice {
  return {
    id,
    userId: "33333333-3333-3333-3333-333333333333",
    name: `device-${id.slice(0, 1)}`,
    hostname: "host.local",
    port: 9876,
    capabilities: [],
    derivedStatus: "offline",
    lastHeartbeat: null,
    wsConnected: false,
    createdAt: "2026-09-01T00:00:00Z",
    tenant_bindings,
  };
}

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RegisteredDevicesList showOnlyOnline={false} />
    </QueryClientProvider>
  );
}

describe("RegisteredDevicesList tenant bindings", () => {
  beforeEach(() => {
    getRunnersMock.mockReset();
  });

  it("renders each tri-state as its own chip row", async () => {
    getRunnersMock.mockResolvedValue([
      device("1".repeat(32), null),
      device("2".repeat(32), []),
      device("3".repeat(32), [
        {
          tenant_id: TENANT_A,
          tenant_slug: "acme",
          last_active_at: "2026-09-05T08:00:00Z",
        },
        { tenant_id: TENANT_B, tenant_slug: null, last_active_at: null },
      ]),
    ]);

    renderList();

    const rows = await screen.findAllByTestId("tenant-bindings");
    expect(rows).toHaveLength(3);

    const [unknownRow, noneRow, boundRow] = rows;

    expect(unknownRow).toHaveAttribute("data-bindings-kind", "unknown");
    expect(
      within(unknownRow).getByTestId("tenant-bindings-unknown")
    ).toHaveTextContent("bindings unknown");
    expect(within(unknownRow).queryByTestId("tenant-bindings-none")).toBeNull();

    expect(noneRow).toHaveAttribute("data-bindings-kind", "none");
    expect(
      within(noneRow).getByTestId("tenant-bindings-none")
    ).toHaveTextContent("no tenant bindings");
    expect(within(noneRow).queryByTestId("tenant-bindings-unknown")).toBeNull();

    expect(boundRow).toHaveAttribute("data-bindings-kind", "bound");
    const chips = within(boundRow).getAllByTestId("tenant-binding-chip");
    expect(chips.map((c) => c.textContent)).toEqual(["acme", "bbbbbbbb"]);
    expect(chips[0]).toHaveAttribute(
      "title",
      expect.stringContaining(`Tenant ${TENANT_A} · last active `)
    );
    expect(chips[1]).toHaveAttribute(
      "title",
      `Tenant ${TENANT_B} · last active never`
    );
    expect(within(boundRow).queryByTestId("tenant-bindings-unknown")).toBeNull();
    expect(within(boundRow).queryByTestId("tenant-bindings-none")).toBeNull();
  });

  it("keeps the existing device identity elements on the row", async () => {
    getRunnersMock.mockResolvedValue([device("4".repeat(32), null)]);

    renderList();

    expect(await screen.findByText("device-4")).toBeInTheDocument();
    expect(screen.getByText("Deregister")).toBeInTheDocument();
    expect(screen.getAllByText("Offline").length).toBeGreaterThan(0);
  });
});
