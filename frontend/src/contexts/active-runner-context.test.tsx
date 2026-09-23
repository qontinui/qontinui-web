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

// Coord's resolver, as the web backend answers it. Each test scripts it; the
// default is the pre-deploy answer (qontinui-coord#2402 not deployed).
const resolver = vi.hoisted(() => ({
  answer: (() => ({
    status: "unavailable",
    reason: "not_deployed",
    httpStatus: 404,
    code: null,
  })) as (input: {
    capabilities: readonly string[];
    workClass: string;
    preferred?: string | null;
  }) => unknown,
  calls: [] as Array<{
    capabilities: readonly string[];
    workClass: string;
    preferred?: string | null;
  }>,
}));
vi.mock("@/lib/runner/resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runner/resolve")>()),
  requestDeviceResolve: async (input: {
    capabilities: readonly string[];
    workClass: string;
    preferred?: string | null;
  }) => {
    resolver.calls.push(input);
    return resolver.answer(input);
  },
}));

function resolveTo(deviceId: string) {
  resolver.answer = (input) => ({
    status: "resolved",
    deviceId,
    via: input.preferred === deviceId ? "pin" : "pool",
    pinReleased: null,
  });
}

function resolverUnavailable() {
  resolver.answer = () => ({
    status: "unavailable",
    reason: "coord_unreachable",
    httpStatus: null,
    code: null,
  });
}

import {
  ActiveRunnerProvider,
  dispatchTargetFrom,
  resolveRunnerTarget,
  useActiveRunner,
  useDispatchRunnerTarget,
  useDispatchTarget,
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
  resolver.calls = [];
  resolverUnavailable();
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
    const direct = runnerFetch<{ answeredBy: string }>(latestTarget, "/health");
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
    resolveTo(LOCAL_ID);
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

describe("ActiveRunnerProvider auto-select is coord's resolver", () => {
  it("targets the device coord resolves — not runners[0], and not the local runner", async () => {
    // runners[0] is LOCAL (proven on this box); coord picks REMOTE.
    const fetchSpy = stubMachine({ 9876: LOCAL_ID });
    resolveTo(REMOTE_ID);
    setList([runner(LOCAL_ID, 9876), runner(REMOTE_ID, 9877)]);

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(REMOTE_ID)
    );
    await waitFor(() =>
      expect(screen.getByTestId("data").textContent).toBe("relay")
    );
    expect(relayCalls().every((c) => c.deviceId === REMOTE_ID)).toBe(true);
    expect(nonProbeCalls(fetchSpy)).toEqual([]);
    // Asked as placeable work with no requirement, and no user named.
    expect(resolver.calls[0]).toEqual({
      capabilities: [],
      workClass: "placeable",
      preferred: null,
    });
  });

  it("re-asks with the last resolved device as the pin, so the pick is sticky", async () => {
    stubMachine({});
    resolveTo(REMOTE_ID);
    setList([runner(LOCAL_ID, 9876), runner(REMOTE_ID, 9877)]);

    renderProvider();
    await waitFor(() =>
      expect(resolver.calls.some((c) => c.preferred === REMOTE_ID)).toBe(true)
    );
  });

  it("an explicit selection is the pin and stays the target", async () => {
    stubMachine({});
    localStorage.setItem(STORAGE_KEY, LOCAL_ID);
    resolveTo(REMOTE_ID);
    setList([runner(LOCAL_ID, 9876), runner(REMOTE_ID, 9877)]);

    renderProvider();
    await waitFor(() => expect(resolver.calls.length).toBeGreaterThan(0));
    expect(resolver.calls[0]!.preferred).toBe(LOCAL_ID);
    expect(screen.getByTestId("active").textContent).toBe(LOCAL_ID);
  });

  it("a resolver outage keeps the LAST resolved target, never runners[0]", async () => {
    stubMachine({});
    resolveTo(REMOTE_ID);
    setList([runner(LOCAL_ID, 9876), runner(REMOTE_ID, 9877)]);

    const { rerender } = renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(REMOTE_ID)
    );

    // Coord goes dark; a list change makes the provider re-ask.
    resolverUnavailable();
    const asked = resolver.calls.length;
    setList([
      runner(LOCAL_ID, 9876),
      runner(REMOTE_ID, 9877),
      runner(GONE_ID, 9878),
    ]);
    rerender(
      <ActiveRunnerProvider>
        <Page />
      </ActiveRunnerProvider>
    );
    await waitFor(() => expect(resolver.calls.length).toBeGreaterThan(asked));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(screen.getByTestId("active").textContent).toBe(REMOTE_ID);
    expect(latestTarget).toMatchObject({
      kind: "runner",
      runner: { id: REMOTE_ID },
    });
  });

  it("a resolver outage with nothing resolved yet NEVER falls back to runners[0]", async () => {
    // Neither runner is on this box (no port answers with its id).
    const fetchSpy = stubMachine({ 9876: GONE_ID });
    resolverUnavailable();
    setList([runner(REMOTE_ID, 9876), runner(LOCAL_ID, 9877)]);

    renderProvider();
    await waitFor(() =>
      expect(latestTarget).toEqual({
        kind: "unavailable",
        reason: "resolver_unavailable",
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toMatch(
        /device resolver did not answer/
      )
    );
    expect(screen.getByTestId("active").textContent).toBe("none");
    expect(nonProbeCalls(fetchSpy)).toEqual([]);
    expect(relayFetch).not.toHaveBeenCalled();
  });

  it("a resolver outage with nothing resolved yet uses a runner PROVEN local (identity, not list order)", async () => {
    // runners[0] is REMOTE; LOCAL (listed second) answers :9876 with its id.
    const fetchSpy = stubMachine({ 9876: LOCAL_ID, 9877: GONE_ID });
    resolverUnavailable();
    setList([runner(REMOTE_ID, 9877), runner(LOCAL_ID, 9876)]);

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(LOCAL_ID)
    );
    await waitFor(() =>
      expect(nonProbeCalls(fetchSpy)).toContain("http://127.0.0.1:9876/health")
    );
    expect(relayCalls().map((c) => c.deviceId)).not.toContain(REMOTE_ID);
  });

  it("a DRAINED own machine that is proven local still serves library/results reads", async () => {
    // Coord: nothing is eligible for NEW work (this box is drained).
    const fetchSpy = stubMachine({ 9876: LOCAL_ID, 9877: GONE_ID });
    resolver.answer = () => ({ status: "all_drained", pinReleased: null });
    setList([runner(REMOTE_ID, 9877), runner(LOCAL_ID, 9876)]);

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(LOCAL_ID)
    );
    await waitFor(() =>
      expect(screen.getByTestId("data").textContent).toBe(LOCAL_ID)
    );
    expect(nonProbeCalls(fetchSpy)).toContain("http://127.0.0.1:9876/health");
    expect(relayCalls().map((c) => c.deviceId)).not.toContain(REMOTE_ID);
  });

  it("the drained machine that still serves READS is not a target for NEW work", async () => {
    stubMachine({ 9876: LOCAL_ID, 9877: GONE_ID });
    resolver.answer = () => ({ status: "all_drained", pinReleased: null });
    setList([runner(REMOTE_ID, 9877), runner(LOCAL_ID, 9876)]);

    let dispatch: ReturnType<typeof useDispatchTarget> | null = null;
    const Probe = () => {
      dispatch = useDispatchTarget();
      return null;
    };
    render(
      <ActiveRunnerProvider>
        <Page />
        <Probe />
      </ActiveRunnerProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(LOCAL_ID)
    );
    expect(dispatch).toMatchObject({ runnerId: null, reason: "all_drained" });
  });

  it("'nothing eligible' with no runner to keep addresses none — never runners[0]", async () => {
    const fetchSpy = stubMachine({ 9876: GONE_ID });
    resolver.answer = () => ({
      status: "no_capable",
      missing: [],
      onlineDevices: 0,
      pinReleased: null,
    });
    setList([runner(REMOTE_ID, 9876), runner(LOCAL_ID, 9877)]);

    renderProvider();
    await waitFor(() =>
      expect(latestTarget).toEqual({
        kind: "unavailable",
        reason: "no_eligible_runner",
      })
    );
    expect(screen.getByTestId("active").textContent).toBe("none");
    expect(nonProbeCalls(fetchSpy)).toEqual([]);
    expect(relayFetch).not.toHaveBeenCalled();
  });

  it("a SOLE runner is the target while coord has not answered, and when it is UNKNOWN", async () => {
    // Coord never answers the first request...
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    resolver.answer = async () => {
      await held;
      return {
        status: "unavailable",
        reason: "coord_unreachable",
        httpStatus: null,
        code: null,
      };
    };
    stubMachine({});
    setList([runner(REMOTE_ID, 9877)]);

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(REMOTE_ID)
    );
    await act(async () => {
      release();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByTestId("active").textContent).toBe(REMOTE_ID);
    await waitFor(() =>
      expect(relayCalls().map((c) => c.deviceId)).toContain(REMOTE_ID)
    );
  });

  it("clearing an explicit selection returns to coord's FREE choice — the selection is never the auto pin", async () => {
    stubMachine({});
    localStorage.setItem(STORAGE_KEY, LOCAL_ID);
    resolveTo(LOCAL_ID);
    setList([runner(LOCAL_ID, 9876), runner(REMOTE_ID, 9877)]);

    const Clear = () => {
      const { selectRunner } = useActiveRunner();
      return (
        <button onClick={() => selectRunner(null)} data-testid="clear">
          clear
        </button>
      );
    };
    render(
      <ActiveRunnerProvider>
        <Page />
        <Clear />
      </ActiveRunnerProvider>
    );
    await waitFor(() =>
      expect(resolver.calls.some((c) => c.preferred === LOCAL_ID)).toBe(true)
    );

    resolveTo(REMOTE_ID);
    const before = resolver.calls.length;
    await act(async () => {
      screen.getByTestId("clear").click();
    });
    await waitFor(() => expect(resolver.calls.length).toBeGreaterThan(before));
    // The first automatic question after clearing carries NO pin.
    expect(resolver.calls[before]!.preferred).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(REMOTE_ID)
    );
  });
});

describe("ActiveRunnerProvider disconnect", () => {
  it("clears the selection instead of storing runners[0], and coord's pick takes over", async () => {
    const fetchSpy = stubMachine({ 9876: LOCAL_ID, 9878: GONE_ID });
    resolveTo(LOCAL_ID);
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

describe("dispatchTargetFrom — where NEW work goes", () => {
  const listed = [runner(REMOTE_ID, 9877), runner(LOCAL_ID, 9876)];
  const base = {
    listState: "loaded" as const,
    runners: listed,
    selectedId: null as string | null,
  };

  it("an explicit selection is the dispatch target", () => {
    expect(
      dispatchTargetFrom({
        ...base,
        selectedId: LOCAL_ID,
        resolution: { status: "all_drained", pinReleased: null },
      })
    ).toEqual({ runnerId: LOCAL_ID, reason: "explicit", message: null });
  });

  it("coord's resolved device is the dispatch target", () => {
    expect(
      dispatchTargetFrom({
        ...base,
        resolution: {
          status: "resolved",
          deviceId: REMOTE_ID,
          via: "pool",
          pinReleased: null,
        },
      })
    ).toEqual({ runnerId: REMOTE_ID, reason: "resolved", message: null });
  });

  it.each([
    [{ status: "loading" }, "resolving"],
    [
      {
        status: "unavailable",
        reason: "not_deployed",
        httpStatus: 404,
        code: null,
      },
      "resolver_unavailable",
    ],
    [{ status: "drain_unreadable" }, "drain_unreadable"],
    [
      {
        status: "no_capable",
        missing: [],
        onlineDevices: 0,
        pinReleased: null,
      },
      "no_capable",
    ],
    [{ status: "all_drained", pinReleased: null }, "all_drained"],
  ] as const)(
    "%o names NO runner (reason %s), even with one listed",
    (res, reason) => {
      for (const runners of [listed, [runner(LOCAL_ID, 9876)]]) {
        const out = dispatchTargetFrom({ ...base, runners, resolution: res });
        expect(out.runnerId).toBeNull();
        expect(out.reason).toBe(reason);
        expect(out.message).toBeTruthy();
      }
    }
  );

  it("list loading / failed / empty name no runner", () => {
    const resolution = { status: "loading" } as const;
    expect(
      dispatchTargetFrom({ ...base, listState: "loading", resolution }).reason
    ).toBe("list_loading");
    expect(
      dispatchTargetFrom({ ...base, listState: "failed", resolution }).reason
    ).toBe("list_unavailable");
    expect(
      dispatchTargetFrom({ ...base, runners: [], resolution }).reason
    ).toBe("no_runner");
  });
});

describe("the new-work target and the read target agree whenever new work is allowed", () => {
  // Surfaces that start work through a read-target client gate on
  // useNewWorkRefusal(); that is sound only because an allowed dispatch
  // always addresses the device the read target addresses — so the job's
  // follow-up polls, stop and results reads hit the runner it started on.
  const listed = [runner(REMOTE_ID, 9877), runner(LOCAL_ID, 9876)];
  const UNLISTED = "99999999-9999-4999-8999-999999999999";
  const cases: Array<{
    name: string;
    selectedId: string | null;
    resolution: Parameters<typeof dispatchTargetFrom>[0]["resolution"];
  }> = [
    {
      name: "explicit",
      selectedId: REMOTE_ID,
      resolution: { status: "all_drained", pinReleased: null },
    },
    {
      name: "resolved (listed)",
      selectedId: null,
      resolution: {
        status: "resolved",
        deviceId: LOCAL_ID,
        via: "pool",
        pinReleased: null,
      },
    },
    {
      name: "resolved (not listed)",
      selectedId: null,
      resolution: {
        status: "resolved",
        deviceId: UNLISTED,
        via: "pool",
        pinReleased: null,
      },
    },
  ];
  it.each(cases)("$name", ({ selectedId, resolution }) => {
    const dispatch = dispatchTargetFrom({
      listState: "loaded",
      runners: listed,
      selectedId,
      resolution,
    });
    const read = resolveRunnerTarget({
      listState: "loaded",
      runners: listed,
      selectedId,
      localityById: new Map([[LOCAL_ID, "local"]]),
      resolution,
      lastResolvedId: REMOTE_ID,
    });
    expect(dispatch.runnerId).not.toBeNull();
    expect(read.target).toMatchObject({
      kind: "runner",
      runner: { id: dispatch.runnerId },
    });
  });
});

describe("refusal === null ⇒ new work and reads address the same device (sweep)", () => {
  type Res = Parameters<typeof dispatchTargetFrom>[0]["resolution"];
  const UNLISTED = "99999999-9999-4999-8999-999999999999";
  const resolutions: Res[] = [
    { status: "loading" },
    { status: "resolved", deviceId: LOCAL_ID, via: "pool", pinReleased: null },
    { status: "resolved", deviceId: REMOTE_ID, via: "pin", pinReleased: null },
    { status: "resolved", deviceId: UNLISTED, via: "pool", pinReleased: null },
    {
      status: "pin_ineligible",
      deviceId: REMOTE_ID,
      reason: "drained",
      detail: "drained",
      missingCapabilities: [],
    },
    { status: "no_capable", missing: [], onlineDevices: 0, pinReleased: null },
    { status: "all_drained", pinReleased: null },
    { status: "drain_unreadable" },
    {
      status: "unavailable",
      reason: "coord_unreachable",
      httpStatus: null,
      code: null,
    },
  ];
  const lists = [
    [runner(REMOTE_ID, 9877), runner(LOCAL_ID, 9876)],
    [runner(REMOTE_ID, 9877)],
  ];
  const localities: Array<Map<string, "local" | "not_local" | "unknown">> = [
    new Map(), // nothing measured yet
    new Map([[LOCAL_ID, "local"]]),
    new Map([
      [LOCAL_ID, "not_local"],
      [REMOTE_ID, "unknown"],
    ]),
  ];
  const selections = [null, REMOTE_ID, LOCAL_ID, GONE_ID];
  const lastResolved = [null, REMOTE_ID, LOCAL_ID];

  it("holds for every status × selection × locality × last-resolved", () => {
    let allowed = 0;
    for (const resolution of resolutions)
      for (const runners of lists)
        for (const localityById of localities)
          for (const selectedId of selections)
            for (const lastResolvedId of lastResolved) {
              const dispatch = dispatchTargetFrom({
                listState: "loaded",
                runners,
                selectedId,
                resolution,
              });
              if (dispatch.runnerId === null) {
                expect(dispatch.message).toBeTruthy();
                continue;
              }
              allowed += 1;
              const read = resolveRunnerTarget({
                listState: "loaded",
                runners,
                selectedId,
                localityById,
                resolution,
                lastResolvedId,
              });
              expect(read.target).toMatchObject({
                kind: "runner",
                runner: { id: dispatch.runnerId },
              });
            }
    // The sweep actually exercised allowed cases.
    expect(allowed).toBeGreaterThan(0);
  });

  it("no_runner (loaded, empty list): the new-work target IS the read target, unrefused", async () => {
    stubMachine({});
    setList([]);
    let dispatch: ReturnType<typeof useDispatchRunnerTarget> | null = null;
    let read: RunnerTarget | null = null;
    const Probe = () => {
      dispatch = useDispatchRunnerTarget();
      read = useRunnerTarget();
      return null;
    };
    render(
      <ActiveRunnerProvider>
        <Probe />
      </ActiveRunnerProvider>
    );
    await waitFor(() => expect(read).toEqual({ kind: "default_local" }));
    expect(dispatch!.refusal).toBeNull();
    expect(dispatch!.runnerId).toBeNull();
    expect(dispatch!.target).toEqual(read);
  });
});
