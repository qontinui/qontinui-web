/**
 * DiscoveryPanel addresses the runner picked in its selector by ID, through
 * the resolver — never `http://<reported-ip>:<port>`. The runner binds
 * 127.0.0.1 only, so a URL built from the address it reports never answers,
 * and an address proves nothing about which machine would. A runner that is
 * not on this machine is reached through the relay, which carries none of
 * the SDK/exploration routes, and the panel must say so as its own typed
 * "needs the runner on this machine" state.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const relayFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => relayFetch(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));

const RUNNERS = [
  {
    id: "by-ip",
    name: "Build box",
    hostname: null,
    ipAddress: "10.20.30.40",
    port: 9876,
  },
  {
    id: "by-host",
    name: "Laptop",
    hostname: "laptop.lan",
    ipAddress: null,
    port: 9877,
  },
];

vi.mock("@/hooks/useRealtimeConnections", () => ({
  useRealtimeConnections: () => ({ runners: RUNNERS, isLoading: false }),
}));

vi.mock("@/contexts/active-runner-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/contexts/active-runner-context")>();
  const localityById = new Map([
    ["by-ip", "not_local"],
    ["by-host", "not_local"],
  ]);
  const pending = { kind: "pending" };
  return {
    ...actual,
    useRunnerTarget: () => pending,
    useActiveRunner: () => ({ localityById }),
  };
});

vi.mock("@/hooks/useUIBridgeExploration", () => {
  const exploration = {
    config: {},
    updateConfig: () => {},
    progress: { status: "idle" },
    isRunning: false,
    startUIBridgeExploration: async () => null,
    stopExploration: async () => {},
    getRenderLogsForDiscovery: () => [],
  };
  return { useUIBridgeExploration: () => exploration };
});

vi.mock("@/hooks/useUIBridgeRecording", () => ({
  useUIBridgeRecording: () => ({ session: {} }),
}));

vi.mock("@/components/ui-bridge/ExplorationConfigPanel", () => ({
  ExplorationConfigPanel: () => null,
}));
vi.mock("@/components/ui-bridge/SdkRecordingPanel", () => ({
  SdkRecordingPanel: () => null,
}));

// A native <select> stands in for the Radix one, which jsdom cannot drive.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select
      aria-label="runner"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="">none</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { DiscoveryPanel } from "./DiscoveryPanel";

/** The runner's own relay-path refusal (qontinui-runner `http_relay_error`). */
const RELAY_PATH_REFUSAL = {
  error:
    "this path is not carried by the HTTP relay — the relay serves a closed set of routes",
};

let loopbackFetch: ReturnType<typeof vi.fn>;

function allFetchedUrls(): string[] {
  return [
    ...relayFetch.mock.calls.map((c) => String(c[0])),
    ...loopbackFetch.mock.calls.map((c) => String(c[0])),
  ];
}

function relayDeviceIds(): string[] {
  return relayFetch.mock.calls.map(
    (c) =>
      (c[1] as { headers: Record<string, string> }).headers[
        "X-Qontinui-Device-Id"
      ]!
  );
}

function renderPanel() {
  const discovery = {
    renders: null,
    renderSource: null,
    discoveryResult: null,
    isDiscovering: false,
    configName: "",
    setConfigName: () => {},
    isSaving: false,
    setRenders: () => {},
    runDiscovery: async () => {},
    saveToProject: async () => null,
    reset: () => {},
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DiscoveryPanel
        discovery={discovery as never}
        onConfigCreated={() => {}}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  relayFetch.mockReset();
  relayFetch.mockImplementation(
    async () =>
      new Response(JSON.stringify(RELAY_PATH_REFUSAL), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
  );
  loopbackFetch = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", loopbackFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<DiscoveryPanel> runner transport", () => {
  it("never fetches the runner's reported address; reaches it through the relay by id", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("runner"), {
      target: { value: "by-ip" },
    });

    await waitFor(() => expect(relayFetch).toHaveBeenCalled());
    await waitFor(() =>
      expect(allFetchedUrls()).toEqual(
        expect.arrayContaining([
          "https://api.test/api/v1/device-bridge/runner-proxy/ui-bridge/sdk/connections",
        ])
      )
    );
    expect(allFetchedUrls().filter((u) => u.includes("10.20.30.40"))).toEqual(
      []
    );
    expect(loopbackFetch).not.toHaveBeenCalled();
    expect(new Set(relayDeviceIds())).toEqual(new Set(["by-ip"]));
  });

  it("shows the typed needs-the-runner-on-this-machine state for a runner on another machine", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("runner"), {
      target: { value: "by-ip" },
    });

    const alert = await screen.findByTestId("runner-needs-local");
    expect(alert.textContent).toMatch(/needs the runner on this machine/);
  });

  it("keeps a runner identified only by hostname selectable and resolvable by id", async () => {
    renderPanel();
    expect(screen.getByRole("option", { name: "Laptop (laptop.lan)" })).toBe(
      screen.getByRole("option", { name: /Laptop/ })
    );
    fireEvent.change(screen.getByLabelText("runner"), {
      target: { value: "by-host" },
    });

    await waitFor(() => expect(relayFetch).toHaveBeenCalled());
    expect(new Set(relayDeviceIds())).toEqual(new Set(["by-host"]));
    expect(allFetchedUrls().some((u) => u.includes("laptop.lan"))).toBe(false);
  });
});
