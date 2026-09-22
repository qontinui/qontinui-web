/**
 * Provider-level tests for ActiveRunnerProvider's runner transport (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 1).
 *
 * The provider is driven through a mocked realtime runner list and a fetch
 * stub standing in for THIS machine's loopback ports, so what is asserted is
 * what the browser would actually request.
 *
 * - Page load: child queries mount (and their effects run) BEFORE the
 *   provider's, while the runner list is still loading. A stored selection of
 *   a runner on another machine must not let any of them reach :9876.
 * - Auto-select: a remote runners[0] measured first must not refuse calls a
 *   local runner still being probed will serve.
 * - Disconnect: the selection is cleared, never replaced by runners[0].
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import type { Runner } from "@qontinui/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ActiveRunnerProvider,
  useActiveRunner,
} from "@/contexts/active-runner-context";
import {
  RUNNER_LIST_UNAVAILABLE,
  RUNNER_NOT_LOCAL,
  RunnerApiError,
  runnerFetch,
  setRunnerTransport,
  useRunnerQuery,
} from "@/lib/runner/api-client";
import { __resetRunnerLocalityCache } from "@/lib/runner/locality";

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

/** A page's content: one runner query, plus the active runner's id. */
function Page() {
  const { activeRunner } = useActiveRunner();
  const { data, error } = useRunnerQuery<{ answeredBy: string }>("/health");
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
  setRunnerTransport({ kind: "no_loopback", reason: "measuring" });
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
  it("on a FRESHLY loaded module (no transport reset), no query reaches :9876 before the list arrives", async () => {
    // Every other test here resets the transport in beforeEach; this one
    // loads api-client and the provider afresh so what it observes is the
    // module's own default — child query effects run before the provider's,
    // so a loopback default would be fetched before anything can stop it.
    vi.resetModules();
    const fresh = await import("@/contexts/active-runner-context");
    const freshApi = await import("@/lib/runner/api-client");
    expect(freshApi.getRunnerTransport()).toEqual({
      kind: "no_loopback",
      reason: "measuring",
    });

    const fetchSpy = stubMachine({ 9876: LOCAL_ID });
    localStorage.setItem(STORAGE_KEY, REMOTE_ID);
    setList([], true);

    function FreshPage() {
      const { data } = freshApi.useRunnerQuery<{ answeredBy: string }>(
        "/health"
      );
      return <span data-testid="fresh-data">{data?.answeredBy ?? "none"}</span>;
    }
    render(
      <fresh.ActiveRunnerProvider>
        <FreshPage />
      </fresh.ActiveRunnerProvider>
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(nonProbeCalls(fetchSpy)).toEqual([]);
    expect(screen.getByTestId("fresh-data").textContent).toBe("none");
  });

  it("makes zero non-probe requests while the list loads, and none once it proves the runner remote", async () => {
    // This box's own runner owns :9876; the stored selection is a runner on
    // another machine that also reports :9876.
    const fetchSpy = stubMachine({ 9876: LOCAL_ID });
    localStorage.setItem(STORAGE_KEY, REMOTE_ID);
    setList([], true);

    const { rerender } = renderProvider();
    const direct = runnerFetch("/health").catch((e: unknown) => e);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(nonProbeCalls(fetchSpy)).toEqual([]);
    expect(screen.getByTestId("data").textContent).toBe("none");

    // The list arrives: the stored remote runner is listed and measured.
    setList([runner(REMOTE_ID, 9876)]);
    rerender(
      <ActiveRunnerProvider>
        <Page />
      </ActiveRunnerProvider>
    );

    const err = await direct;
    expect(err).toBeInstanceOf(RunnerApiError);
    expect((err as RunnerApiError).code).toBe(RUNNER_NOT_LOCAL);
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toMatch(/another machine/)
    );
    expect(screen.getByTestId("active").textContent).toBe(REMOTE_ID);
    expect(screen.getByTestId("data").textContent).toBe("none");
    expect(nonProbeCalls(fetchSpy)).toEqual([]);
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
    // on screen as if it were the remote's.
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
    const err = await runnerFetch("/health").catch((e: unknown) => e);
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
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toMatch(
        /could not be confirmed/
      )
    );
    // It does not jump to runners[0], which is another machine.
    expect(screen.getByTestId("active").textContent).toBe(LOCAL_ID);
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
    const direct = runnerFetch<{ answeredBy: string }>("/health");
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
