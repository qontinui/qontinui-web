/**
 * Provider-level tests for ActiveRunnerProvider's runner target (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phases 1-2).
 *
 * The provider is driven through a mocked realtime runner list and a fetch
 * stub standing in for THIS machine's loopback ports, so what is asserted is
 * what the browser would actually request.
 *
 * - Page load: child queries mount (and their effects run) BEFORE the
 *   provider's, while the runner list is still loading. A stored selection of
 *   a runner on another machine must not let any of them reach :9876; once
 *   listed, that runner is reached over the relay by its device id.
 * - Auto-select: a remote runners[0] measured first must not refuse calls a
 *   local runner still being probed will serve.
 * - Disconnect: the selection is cleared, never replaced by runners[0].
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import type { Runner } from "@qontinui/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const relayFetch = vi.hoisted(() => vi.fn());
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => relayFetch(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));

import {
  ActiveRunnerProvider,
  useActiveRunner,
  useRunnerTarget,
} from "@/contexts/active-runner-context";
import {
  RUNNER_LIST_UNAVAILABLE,
  RunnerApiError,
  runnerFetch,
  useRunnerQuery,
} from "@/lib/runner/api-client";
import { __resetRunnerLocalityCache } from "@/lib/runner/locality";
import { NO_RUNNER_TARGET, type RunnerTarget } from "@/lib/runner/target";

const STORAGE_KEY = "qontinui:activeRunnerId";
const REMOTE_ID = "11111111-1111-4111-8111-111111111111";
const LOCAL_ID = "22222222-2222-4222-8222-222222222222";
const GONE_ID = "33333333-3333-4333-8333-333333333333";

const realtime = vi.hoisted(() => ({
  value: {
    runners: [] as unknown[],
    isLoading: true,
    loaded: false,
    loadError: null as Error | null,
  },
}));

vi.mock("@/contexts/realtime-connections-context", () => ({
  useRealtimeConnectionsContext: () => ({
    runners: realtime.value.runners,
    isLoading: realtime.value.isLoading,
    loaded: realtime.value.loaded,
    loadError: realtime.value.loadError,
    isConnected: true,
    refetch: async () => realtime.value.runners,
  }),
}));

function runner(id: string, port: number): Runner {
  return {
    id,
    name: id === LOCAL_ID ? "this-box" : `box-${id.slice(0, 4)}`,
    port,
    capabilities: [],
    createdAt: "2026-09-20T00:00:00Z",
    derivedStatus: "healthy",
  } as unknown as Runner;
}

function setList(runners: Runner[], isLoading = false) {
  realtime.value = { runners, isLoading, loaded: !isLoading, loadError: null };
}

/** The realtime context after a first load that FAILED: empty, not loading. */
function setListFailed() {
  realtime.value = {
    runners: [],
    isLoading: false,
    loaded: false,
    loadError: new Error("GET /api/v1/devices failed"),
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * THIS machine: `portOwners` maps a loopback port to the device id of the
 * runner that owns it. A probe of a port may be held open with `holdProbe`.
 * Every non-probe request answers 200 — the silent wrong-box hit.
 */
function stubMachine(
  portOwners: Record<number, string>,
  holdProbe: Record<number, Promise<void>> = {}
) {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const port = Number(url.port);
    if (url.pathname === "/settings/device-info") {
      await holdProbe[port];
      const owner = portOwners[port];
      if (owner === undefined) throw new TypeError("Failed to fetch");
      return jsonResponse({ success: true, data: { device_id: owner } });
    }
    return jsonResponse({ ok: true, answeredBy: portOwners[port] ?? null });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function nonProbeCalls(fetchSpy: ReturnType<typeof vi.fn>): string[] {
  return fetchSpy.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => !url.endsWith("/settings/device-info"));
}

/** The provider's latest target, for direct (non-hook) runner calls. */
let latestTarget: RunnerTarget = NO_RUNNER_TARGET;

function relayCalls(): Array<{ url: string; deviceId: string }> {
  return relayFetch.mock.calls.map((call) => ({
    url: String(call[0]),
    deviceId: ((call[1] as RequestInit).headers as Record<string, string>)[
      "X-Qontinui-Device-Id"
    ]!,
  }));
}

/** A page's content: one runner query, plus the active runner's id. */
function Page() {
  const { activeRunner } = useActiveRunner();
  const target = useRunnerTarget();
  latestTarget = target;
  const { data, error } = useRunnerQuery<{ answeredBy: string }>(
    target,
    "/health"
  );
  return (
    <div>
      <span data-testid="active">{activeRunner?.id ?? "none"}</span>
      <span data-testid="data">{data ? data.answeredBy : "none"}</span>
      <span data-testid="error">{error ?? "none"}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <ActiveRunnerProvider>
      <Page />
    </ActiveRunnerProvider>
  );
}

const originalLocation = window.location;

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: {
      ...originalLocation,
      origin: "http://localhost:3001",
      href: "http://localhost:3001/build/workflows",
    },
    writable: true,
  });
  localStorage.clear();
  __resetRunnerLocalityCache();
  latestTarget = NO_RUNNER_TARGET;
  relayFetch.mockReset();
  relayFetch.mockImplementation(async () =>
    jsonResponse({ ok: true, answeredBy: "relay" })
  );
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
  });
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("ActiveRunnerProvider page load with a stored remote selection", () => {
  it("a query mounted before the list arrives holds a pending target and fetches nothing", async () => {
    // Child query effects run before the provider's. There is no module
    // default to fall back to any more: the target is pending until the list
    // arrives and the runner is measured.
    const fetchSpy = stubMachine({ 9876: LOCAL_ID });
    localStorage.setItem(STORAGE_KEY, REMOTE_ID);
    setList([], true);

    renderProvider();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(latestTarget.kind).toBe("pending");
    expect(nonProbeCalls(fetchSpy)).toEqual([]);
    expect(relayFetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("data").textContent).toBe("none");
  });

  it("makes zero loopback requests while the list loads, and reaches the proven-remote runner over the relay", async () => {
    // This box's own runner owns :9876; the stored selection is a runner on
    // another machine that also reports :9876.
    const fetchSpy = stubMachine({ 9876: LOCAL_ID });
    localStorage.setItem(STORAGE_KEY, REMOTE_ID);
    setList([], true);

    const { rerender } = renderProvider();
    const direct = runnerFetch<{ answeredBy: string }>(
      latestTarget,
      "/health"
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(nonProbeCalls(fetchSpy)).toEqual([]);
    expect(relayFetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("data").textContent).toBe("none");

    // The list arrives: the stored remote runner is listed and measured.
    setList([runner(REMOTE_ID, 9876)]);
    rerender(
      <ActiveRunnerProvider>
        <Page />
      </ActiveRunnerProvider>
    );

    // The in-flight call waited for the provider, then went to the relay —
    // addressed to the REMOTE runner's device id, never to :9876 here.
    await expect(direct).resolves.toEqual({ ok: true, answeredBy: "relay" });
    await waitFor(() =>
      expect(screen.getByTestId("data").textContent).toBe("relay")
    );
    expect(screen.getByTestId("active").textContent).toBe(REMOTE_ID);
    expect(nonProbeCalls(fetchSpy)).toEqual([]);
    expect(relayCalls().every((c) => c.deviceId === REMOTE_ID)).toBe(true);
    expect(relayCalls()[0]!.url).toBe(
      "https://api.test/api/v1/device-bridge/runner-proxy/health"
    );
    // The stored choice survives the load (it is the user's, and listed).
    expect(localStorage.getItem(STORAGE_KEY)).toBe(REMOTE_ID);
  });

  it("drops a previous runner's data the moment the active runner changes", async () => {
    stubMachine({ 9876: LOCAL_ID });
    setList([runner(LOCAL_ID, 9876), runner(REMOTE_ID, 9877)]);

    const { rerender } = renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("data").textContent).toBe(LOCAL_ID)
    );

    // The user picks the remote runner: nothing from the local one may stay
    // on screen as if it were the remote's. (Its relay answer never lands.)
    relayFetch.mockImplementation(() => new Promise(() => {}));
    localStorage.setItem(STORAGE_KEY, REMOTE_ID);
    const Picker = () => {
      const { selectRunner } = useActiveRunner();
      return (
        <button onClick={() => selectRunner(REMOTE_ID)} data-testid="pick">
          pick
        </button>
      );
    };
    rerender(
      <ActiveRunnerProvider>
        <Page />
        <Picker />
      </ActiveRunnerProvider>
    );
    await act(async () => {
      screen.getByTestId("pick").click();
    });
    expect(screen.getByTestId("data").textContent).toBe("none");
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(REMOTE_ID)
    );
    expect(screen.getByTestId("data").textContent).toBe("none");
  });
});

describe("ActiveRunnerProvider failed list load", () => {
  it("makes zero non-probe requests and keeps the stored selection", async () => {
    const fetchSpy = stubMachine({ 9876: LOCAL_ID });
    localStorage.setItem(STORAGE_KEY, REMOTE_ID);
    setListFailed();

    const { rerender } = renderProvider();
    const err = await runnerFetch(latestTarget, "/health").catch(
      (e: unknown) => e
    );
    expect((err as RunnerApiError).code).toBe(RUNNER_LIST_UNAVAILABLE);
    expect((err as RunnerApiError).message).toMatch(
      /runner list could not be loaded/
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(nonProbeCalls(fetchSpy)).toEqual([]);
    expect(screen.getByTestId("data").textContent).toBe("none");
    expect(localStorage.getItem(STORAGE_KEY)).toBe(REMOTE_ID);

    // A later successful load resolves normally, selection intact.
    setList([runner(REMOTE_ID, 9876)]);
    rerender(
      <ActiveRunnerProvider>
        <Page />
      </ActiveRunnerProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(REMOTE_ID)
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(REMOTE_ID);
    expect(nonProbeCalls(fetchSpy)).toEqual([]);
  });

  it("a loaded empty list does not erase a stored selection that was never listed", async () => {
    stubMachine({});
    localStorage.setItem(STORAGE_KEY, REMOTE_ID);
    setList([]);
    renderProvider();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(REMOTE_ID);
  });
});

describe("ActiveRunnerProvider auto-select", () => {
  it("keeps the auto-selected local runner active when a re-measure is inconclusive", async () => {
    // REMOTE is runners[0]; its port is owned by another device on this box.
    const fetchSpy = stubMachine({ 9876: LOCAL_ID, 9877: GONE_ID });
    setList([runner(REMOTE_ID, 9877), runner(LOCAL_ID, 9876)]);
    const { rerender } = renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(LOCAL_ID)
    );

    // The local runner's reported port moves to one nothing answers on:
    // its locality is re-measured as unknown (not a different identity).
    setList([runner(REMOTE_ID, 9877), runner(LOCAL_ID, 9879)]);
    rerender(
      <ActiveRunnerProvider>
        <Page />
      </ActiveRunnerProvider>
    );
    // Not proven local any more: it is reached by its own device id over
    // the relay — never over a loopback port.
    await waitFor(() =>
      expect(relayCalls().map((c) => c.deviceId)).toContain(LOCAL_ID)
    );
    // It does not jump to runners[0], which is another machine.
    expect(screen.getByTestId("active").textContent).toBe(LOCAL_ID);
    expect(relayCalls().map((c) => c.deviceId)).not.toContain(REMOTE_ID);
    expect(nonProbeCalls(fetchSpy)).not.toContain(
      "http://127.0.0.1:9877/health"
    );
  });

  it("does not refuse in-flight calls because runners[0] measured remote first", async () => {
    // runners[0] is remote (its port 9877 is owned by some other device on
    // this box, answering at once); the local runner's probe on 9876 is slow.
    let releaseLocalProbe!: () => void;
    const localProbe = new Promise<void>((r) => (releaseLocalProbe = r));
    const fetchSpy = stubMachine(
      { 9876: LOCAL_ID, 9877: GONE_ID },
      { 9876: localProbe }
    );
    setList([runner(REMOTE_ID, 9877), runner(LOCAL_ID, 9876)]);

    renderProvider();
    const direct = runnerFetch<{ answeredBy: string }>(latestTarget, "/health");
    let settled = false;
    void direct.then(
      () => (settled = true),
      () => (settled = true)
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // runners[0] has been measured not_local by now; the call must still wait.
    expect(settled).toBe(false);
    expect(nonProbeCalls(fetchSpy)).toEqual([]);

    await act(async () => {
      releaseLocalProbe();
    });
    await expect(direct).resolves.toEqual({
      ok: true,
      answeredBy: LOCAL_ID,
    });
    expect(nonProbeCalls(fetchSpy)[0]).toBe("http://127.0.0.1:9876/health");
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(LOCAL_ID)
    );
  });
});

describe("ActiveRunnerProvider with several runners, none local", () => {
  it("requires a choice: nothing is sent to runners[0], over loopback or the relay", async () => {
    const fetchSpy = stubMachine({ 9876: GONE_ID });
    setList([runner(REMOTE_ID, 9876), runner(LOCAL_ID, 9877)]);

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toMatch(/choose one/)
    );
    expect(latestTarget).toEqual({
      kind: "unavailable",
      reason: "selection_required",
    });
    expect(nonProbeCalls(fetchSpy)).toEqual([]);
    expect(relayFetch).not.toHaveBeenCalled();
  });
});

describe("ActiveRunnerProvider disconnect", () => {
  it("clears the selection instead of storing runners[0], and auto-select picks the local runner", async () => {
    const fetchSpy = stubMachine({ 9876: LOCAL_ID, 9878: GONE_ID });
    localStorage.setItem(STORAGE_KEY, GONE_ID);
    // runners[0] is remote; the selected runner is listed and then leaves.
    setList([
      runner(REMOTE_ID, 9877),
      runner(LOCAL_ID, 9876),
      runner(GONE_ID, 9878),
    ]);

    const { rerender } = renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(GONE_ID)
    );

    setList([runner(REMOTE_ID, 9877), runner(LOCAL_ID, 9876)]);
    rerender(
      <ActiveRunnerProvider>
        <Page />
      </ActiveRunnerProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(LOCAL_ID)
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    await waitFor(() =>
      expect(nonProbeCalls(fetchSpy)).toContain("http://127.0.0.1:9876/health")
    );
    expect(nonProbeCalls(fetchSpy)).not.toContain(
      "http://127.0.0.1:9877/health"
    );
  });
});
