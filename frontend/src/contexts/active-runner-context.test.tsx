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

/** Coord honours whatever pin it is asked about; with none it picks `poolId`. */
function resolveToPinOr(poolId: string) {
  resolver.answer = (input) => ({
    status: "resolved",
    deviceId: input.preferred ?? poolId,
    via: input.preferred ? "pin" : "pool",
    pinReleased: null,
  });
}

/** Coord releases any pin as offline and picks `poolId` (placeable). */
function releasePinTo(poolId: string) {
  resolver.answer = (input) =>
    input.workClass === "machine_bound" && input.preferred
      ? {
          status: "pin_ineligible",
          deviceId: input.preferred,
          reason: "offline",
          detail: "no heartbeat for 10 minutes",
          missingCapabilities: [],
        }
      : {
          status: "resolved",
          deviceId: poolId,
          via: "pool",
          pinReleased:
            input.preferred && input.preferred !== poolId
              ? { reason: "offline", detail: "no heartbeat for 10 minutes" }
              : null,
        };
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
  machineBoundDispatchFrom,
  resolveRunnerTarget,
  type RunnerPin,
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
    resolveToPinOr(LOCAL_ID);
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

  it("a pick is sent to coord as the preferred device, and a pick coord honours is the target", async () => {
    stubMachine({});
    localStorage.setItem(STORAGE_KEY, LOCAL_ID);
    resolveToPinOr(REMOTE_ID);
    setList([runner(LOCAL_ID, 9876), runner(REMOTE_ID, 9877)]);

    renderProvider();
    await waitFor(() => expect(resolver.calls.length).toBeGreaterThan(0));
    expect(resolver.calls[0]!.preferred).toBe(LOCAL_ID);
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(LOCAL_ID)
    );
  });

  it("selecting changes no transport: a pick coord releases does not become the target", async () => {
    // The user picks LOCAL; coord releases it (offline) and picks REMOTE.
    // Where calls go follows coord's answer — the pick is only a preference.
    stubMachine({});
    releasePinTo(REMOTE_ID);
    setList([runner(LOCAL_ID, 9876), runner(REMOTE_ID, 9877)]);

    let dispatch: ReturnType<typeof useDispatchRunnerTarget> | null = null;
    const Probe = () => {
      dispatch = useDispatchRunnerTarget();
      const { selectRunner } = useActiveRunner();
      return (
        <button onClick={() => selectRunner(LOCAL_ID)} data-testid="pick">
          pick
        </button>
      );
    };
    render(
      <ActiveRunnerProvider>
        <Page />
        <Probe />
      </ActiveRunnerProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(REMOTE_ID)
    );
    const before = latestTarget;

    await act(async () => {
      screen.getByTestId("pick").click();
    });
    // The pick is stored and asked about...
    expect(localStorage.getItem(STORAGE_KEY)).toBe(LOCAL_ID);
    await waitFor(() =>
      expect(resolver.calls.some((c) => c.preferred === LOCAL_ID)).toBe(true)
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // ...and neither the read target nor the new-work target moved to it.
    expect(screen.getByTestId("active").textContent).toBe(REMOTE_ID);
    expect(latestTarget).toBe(before);
    expect(dispatch!.runnerId).toBe(REMOTE_ID);
    expect(dispatch!.target).toMatchObject({ runner: { id: REMOTE_ID } });
    // The re-target is announced, never silent.
    expect(dispatch!.notice).toMatchObject({
      kind: "pin_released",
      pinId: LOCAL_ID,
      runnerId: REMOTE_ID,
      reason: "offline",
    });
    expect(dispatch!.notice!.text).toBe(
      "Your pick this-box is offline — running on box-1111."
    );
    expect(relayCalls().map((c) => c.deviceId)).not.toContain(LOCAL_ID);
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

describe("ActiveRunnerProvider while coord is asked about a NEW pick", () => {
  it("reads stay put, and an answer about the previous question is never taken as one about the pick", async () => {
    stubMachine({});
    // Coord answers the automatic question at once, and holds its answer
    // about the pick until released.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    resolver.answer = async (input) => {
      if (input.preferred === LOCAL_ID) {
        await held;
        return {
          status: "resolved",
          deviceId: LOCAL_ID,
          via: "pin",
          pinReleased: null,
        };
      }
      return {
        status: "resolved",
        deviceId: REMOTE_ID,
        via: input.preferred ? "pin" : "pool",
        pinReleased: null,
      };
    };
    setList([runner(LOCAL_ID, 9876), runner(REMOTE_ID, 9877)]);

    let dispatch: ReturnType<typeof useDispatchTarget> | null = null;
    const Probe = () => {
      dispatch = useDispatchTarget();
      const { selectRunner } = useActiveRunner();
      return (
        <button onClick={() => selectRunner(LOCAL_ID)} data-testid="pick">
          pick
        </button>
      );
    };
    render(
      <ActiveRunnerProvider>
        <Page />
        <Probe />
      </ActiveRunnerProvider>
    );
    await waitFor(() => expect(dispatch!.runnerId).toBe(REMOTE_ID));
    const before = latestTarget;

    await act(async () => {
      screen.getByTestId("pick").click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // Not "your pick is unavailable — running on REMOTE": coord has not
    // answered about the pick yet, so new work waits and nothing is claimed.
    expect(dispatch).toMatchObject({
      runnerId: null,
      reason: "resolving",
      message: "Checking this-box…",
      notice: null,
    });
    // Reads did not move at selection time.
    expect(latestTarget).toBe(before);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(dispatch!.runnerId).toBe(LOCAL_ID));
    expect(dispatch!.notice).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(LOCAL_ID)
    );
  });
});

describe("ActiveRunnerProvider machine-bound demand", () => {
  it("a surface that remounts asks coord again: no render — not even the first — is enabled by the earlier answer", async () => {
    stubMachine({});
    localStorage.setItem(STORAGE_KEY, LOCAL_ID);
    let hold: Promise<void> | null = null;
    resolver.answer = async (input) => {
      if (input.workClass === "machine_bound" && hold) await hold;
      return {
        status: "resolved",
        deviceId: input.preferred ?? LOCAL_ID,
        via: "pin",
        pinReleased: null,
      };
    };
    setList([runner(LOCAL_ID, 9876), runner(REMOTE_ID, 9877)]);

    // Observes the machine-bound target WITHOUT creating demand.
    let bound: ReturnType<typeof useDispatchTarget> | null = null;
    const Observer = () => {
      bound = useActiveRunner().boundDispatch;
      return null;
    };
    // A surface that starts machine-bound work: records what EVERY one of its
    // renders saw, the first included (effects run only after it).
    const renders: Array<string | null> = [];
    const Surface = () => {
      const d = useDispatchTarget({ workClass: "machine_bound" });
      renders.push(d.runnerId);
      return null;
    };
    const tree = (mounted: boolean) => (
      <ActiveRunnerProvider>
        <Observer />
        {mounted && <Surface />}
      </ActiveRunnerProvider>
    );
    const { rerender } = render(tree(true));
    await waitFor(() => expect(bound!.runnerId).toBe(LOCAL_ID));

    // Unmounted: nothing asks, so the question is `loading`, not the old answer.
    rerender(tree(false));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(bound).toMatchObject({ runnerId: null, reason: "resolving" });

    // Remount with the same pick, coord not answering yet.
    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    const asked = resolver.calls.filter(
      (c) => c.workClass === "machine_bound"
    ).length;
    const firstRemountRender = renders.length;
    rerender(tree(true));
    await waitFor(() =>
      expect(
        resolver.calls.filter((c) => c.workClass === "machine_bound").length
      ).toBeGreaterThan(asked)
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const whileAsking = renders.slice(firstRemountRender);
    expect(whileAsking.length).toBeGreaterThan(0);
    expect(whileAsking.every((id) => id === null)).toBe(true);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(bound!.runnerId).toBe(LOCAL_ID));
  });

  it("the placeable re-ask on a machine-bound answer is bounded: at most one per answer, none once settled", async () => {
    stubMachine({});
    localStorage.setItem(STORAGE_KEY, LOCAL_ID);
    let release!: () => void;
    let hold: Promise<void> | null = new Promise<void>((r) => (release = r));
    resolver.answer = async (input) => {
      if (input.workClass === "machine_bound" && hold) await hold;
      return {
        status: "resolved",
        deviceId: input.preferred ?? LOCAL_ID,
        via: "pin",
        pinReleased: null,
      };
    };
    setList([runner(LOCAL_ID, 9876), runner(REMOTE_ID, 9877)]);
    const count = (workClass: string) =>
      resolver.calls.filter((c) => c.workClass === workClass).length;

    let bound: ReturnType<typeof useDispatchTarget> | null = null;
    const Surface = () => {
      bound = useDispatchTarget({ workClass: "machine_bound" });
      return null;
    };
    render(
      <ActiveRunnerProvider>
        <Surface />
      </ActiveRunnerProvider>
    );
    // Placeable settled; the machine-bound answer is held.
    await waitFor(() => expect(count("machine_bound")).toBe(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const placeableBefore = count("placeable");

    hold = null;
    await act(async () => {
      release();
    });
    await waitFor(() => expect(bound!.runnerId).toBe(LOCAL_ID));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const placeableAfter = count("placeable");
    const boundAnswers = count("machine_bound");
    expect(placeableAfter - placeableBefore).toBeGreaterThanOrEqual(1);
    expect(placeableAfter - placeableBefore).toBeLessThanOrEqual(boundAnswers);

    // Settled: nothing re-asks anything.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(count("placeable")).toBe(placeableAfter);
    expect(count("machine_bound")).toBe(boundAnswers);
  });
});

describe("ActiveRunnerProvider disconnect", () => {
  it("keeps the pick when its runner goes offline; coord releases it and reads follow coord — never runners[0]", async () => {
    const fetchSpy = stubMachine({ 9876: LOCAL_ID, 9878: GONE_ID });
    localStorage.setItem(STORAGE_KEY, GONE_ID);
    // Coord honours GONE while it is online; once it leaves, it releases it.
    resolver.answer = (input) =>
      input.preferred === GONE_ID &&
      (realtime.value.runners as Runner[]).some((r) => r.id === GONE_ID)
        ? {
            status: "resolved",
            deviceId: GONE_ID,
            via: "pin",
            pinReleased: null,
          }
        : {
            status: "resolved",
            deviceId: LOCAL_ID,
            via: "pool",
            pinReleased: { reason: "offline", detail: null },
          };
    // runners[0] is remote; the picked runner is listed and then leaves.
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
    // The pick is the user's; only the user clears it ("Automatic").
    expect(localStorage.getItem(STORAGE_KEY)).toBe(GONE_ID);
    expect(resolver.calls.at(-1)!.preferred).toBe(GONE_ID);
    await waitFor(() =>
      expect(nonProbeCalls(fetchSpy)).toContain("http://127.0.0.1:9876/health")
    );
    expect(nonProbeCalls(fetchSpy)).not.toContain(
      "http://127.0.0.1:9877/health"
    );
  });
});

describe("dispatchTargetFrom — where NEW placeable work goes", () => {
  const listed = [runner(REMOTE_ID, 9877), runner(LOCAL_ID, 9876)];
  const base = {
    listState: "loaded" as const,
    runners: listed,
    pin: null as RunnerPin | null,
  };
  const localPin: RunnerPin = { id: LOCAL_ID, name: "this-box" };

  it("a pick coord honours is the dispatch target, with nothing to announce", () => {
    expect(
      dispatchTargetFrom({
        ...base,
        pin: localPin,
        resolution: {
          status: "resolved",
          deviceId: LOCAL_ID,
          via: "pin",
          pinReleased: null,
        },
      })
    ).toEqual({
      runnerId: LOCAL_ID,
      reason: "resolved",
      message: null,
      notice: null,
      pinRefused: null,
    });
  });

  it("a pick is never a short-circuit past coord: all drained names no runner", () => {
    expect(
      dispatchTargetFrom({
        ...base,
        pin: localPin,
        resolution: { status: "all_drained", pinReleased: null },
      })
    ).toMatchObject({ runnerId: null, reason: "all_drained" });
  });

  it("coord's resolved device is the dispatch target (no pick)", () => {
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
    ).toEqual({
      runnerId: REMOTE_ID,
      reason: "resolved",
      message: null,
      notice: null,
      pinRefused: null,
    });
  });

  it("a released pick goes to coord's pool pick AND announces it (D2)", () => {
    const out = dispatchTargetFrom({
      ...base,
      pin: { id: GONE_ID, name: "old-laptop" },
      resolution: {
        status: "resolved",
        deviceId: REMOTE_ID,
        via: "pool",
        pinReleased: { reason: "drained", detail: null },
      },
    });
    expect(out.runnerId).toBe(REMOTE_ID);
    expect(out.notice).toEqual({
      kind: "pin_released",
      pinId: GONE_ID,
      runnerId: REMOTE_ID,
      reason: "drained",
      text: "Your pick old-laptop is drained — taken out of service for new work — running on box-1111.",
    });
  });

  it("a move off the pick is announced even when coord gives no reason", () => {
    const out = dispatchTargetFrom({
      ...base,
      pin: localPin,
      resolution: {
        status: "resolved",
        deviceId: REMOTE_ID,
        via: "pool",
        pinReleased: null,
      },
    });
    expect(out.notice?.text).toBe(
      "Your pick this-box is not available — running on box-1111."
    );
  });

  it("coord UNKNOWN: a LISTED pick is used unchecked and says so; an unlisted one is refused by name", () => {
    const unknown = {
      status: "unavailable",
      reason: "coord_unreachable",
      httpStatus: null,
      code: null,
    } as const;
    const online = dispatchTargetFrom({
      ...base,
      pin: localPin,
      resolution: unknown,
    });
    expect(online).toMatchObject({
      runnerId: LOCAL_ID,
      reason: "pin_unchecked",
      notice: { kind: "pin_unchecked", pinId: LOCAL_ID },
    });
    const offline = dispatchTargetFrom({
      ...base,
      pin: { id: GONE_ID, name: "old-laptop" },
      resolution: unknown,
    });
    expect(offline.runnerId).toBeNull();
    expect(offline.message).toMatch(
      /Your pick old-laptop is not currently listed/
    );
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

  it("refusals point at the Run-on control by where it is — never at the removed sidebar selector", () => {
    const outcomes: Res[] = [
      {
        status: "unavailable",
        reason: "not_deployed",
        httpStatus: 404,
        code: null,
      },
      { status: "drain_unreadable" },
    ];
    // One runner or several: the Run-on control exists either way.
    for (const runners of [listed, [runner(LOCAL_ID, 9876)]])
      for (const pin of [null, { id: GONE_ID, name: "old-laptop" }])
        for (const resolution of outcomes) {
          const { message } = dispatchTargetFrom({
            ...base,
            runners,
            pin,
            resolution,
          });
          expect(message).not.toMatch(/runner selector/);
          expect(message).toContain(
            "pick a runner with “Run on” (on Co-Pilot, Execute or Capture)"
          );
        }
  });

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

describe("machineBoundDispatchFrom — machine-bound work never moves (D2)", () => {
  const listed = [runner(REMOTE_ID, 9877), runner(LOCAL_ID, 9876)];
  const localPin: RunnerPin = { id: LOCAL_ID, name: "this-box" };
  const placeableOn = (id: string): ReturnType<typeof dispatchTargetFrom> => ({
    runnerId: id,
    reason: "resolved",
    message: null,
    notice: null,
    pinRefused: null,
  });

  it("a refused pick is refused with coord's reason — no runner, alternatives are the user's to choose", () => {
    const out = machineBoundDispatchFrom({
      runners: listed,
      pin: localPin,
      // Placeable work WAS moved to REMOTE; machine-bound work must not be.
      placeable: placeableOn(REMOTE_ID),
      resolution: {
        status: "pin_ineligible",
        deviceId: LOCAL_ID,
        reason: "missing_capabilities",
        detail: "needs screen capture",
        missingCapabilities: ["screen_capture"],
      },
    });
    expect(out.runnerId).toBeNull();
    expect(out.reason).toBe("pin_ineligible");
    expect(out.pinRefused).toEqual({
      deviceId: LOCAL_ID,
      reason: "missing_capabilities",
      detail: "needs screen capture",
      missingCapabilities: ["screen_capture"],
      explicit: true,
    });
    expect(out.message).toMatch(/Your pick this-box can't run this/);
    expect(out.message).toMatch(/missing: screen_capture/);
  });

  it("coord answering with ANOTHER device is refused, never taken", () => {
    const out = machineBoundDispatchFrom({
      runners: listed,
      pin: localPin,
      placeable: placeableOn(LOCAL_ID),
      resolution: {
        status: "resolved",
        deviceId: REMOTE_ID,
        via: "pool",
        pinReleased: null,
      },
    });
    expect(out.runnerId).toBeNull();
    expect(out.pinRefused?.deviceId).toBe(LOCAL_ID);
  });

  it("no pick: coord's automatic device is checked, and used when eligible", () => {
    expect(
      machineBoundDispatchFrom({
        runners: listed,
        pin: null,
        placeable: placeableOn(REMOTE_ID),
        resolution: {
          status: "resolved",
          deviceId: REMOTE_ID,
          via: "pin",
          pinReleased: null,
        },
      })
    ).toMatchObject({ runnerId: REMOTE_ID, reason: "resolved" });
  });

  it("a device the page's reads do not address is 'resolving', not a pick", () => {
    expect(
      machineBoundDispatchFrom({
        runners: listed,
        pin: localPin,
        placeable: placeableOn(REMOTE_ID),
        resolution: {
          status: "resolved",
          deviceId: LOCAL_ID,
          via: "pin",
          pinReleased: null,
        },
      })
    ).toMatchObject({ runnerId: null, reason: "resolving" });
  });

  it("coord UNKNOWN: runs on an online pick only when placeable work does too (unchecked, announced)", () => {
    const placeable = dispatchTargetFrom({
      listState: "loaded",
      runners: listed,
      pin: localPin,
      resolution: {
        status: "unavailable",
        reason: "coord_unreachable",
        httpStatus: null,
        code: null,
      },
    });
    expect(
      machineBoundDispatchFrom({
        runners: listed,
        pin: localPin,
        placeable,
        resolution: {
          status: "unavailable",
          reason: "coord_unreachable",
          httpStatus: null,
          code: null,
        },
      })
    ).toMatchObject({
      runnerId: LOCAL_ID,
      reason: "pin_unchecked",
      notice: { kind: "pin_unchecked" },
    });
  });

  it("no pick and no automatic device: the placeable refusal stands", () => {
    const placeable = dispatchTargetFrom({
      listState: "loaded",
      runners: listed,
      pin: null,
      resolution: { status: "all_drained", pinReleased: null },
    });
    expect(
      machineBoundDispatchFrom({
        runners: listed,
        pin: null,
        placeable,
        resolution: { status: "loading" },
      })
    ).toMatchObject({ runnerId: null, reason: "all_drained" });
  });
});

type Res = Parameters<typeof dispatchTargetFrom>[0]["resolution"];
const UNLISTED = "99999999-9999-4999-8999-999999999999";

describe("the new-work target and the read target agree whenever new work is allowed", () => {
  // Surfaces that start work through a read-target client gate on
  // useNewWorkRefusal(); that is sound only because an allowed dispatch
  // always addresses the device the read target addresses — so the job's
  // follow-up polls, stop and results reads hit the runner it started on.
  const listed = [runner(REMOTE_ID, 9877), runner(LOCAL_ID, 9876)];
  const cases: Array<{ name: string; pin: RunnerPin | null; resolution: Res }> =
    [
      {
        name: "pick, coord unknown",
        pin: { id: REMOTE_ID, name: null },
        resolution: {
          status: "unavailable",
          reason: "coord_unreachable",
          httpStatus: null,
          code: null,
        },
      },
      {
        name: "pick released",
        pin: { id: REMOTE_ID, name: null },
        resolution: {
          status: "resolved",
          deviceId: LOCAL_ID,
          via: "pool",
          pinReleased: { reason: "offline", detail: null },
        },
      },
      {
        name: "resolved (listed)",
        pin: null,
        resolution: {
          status: "resolved",
          deviceId: LOCAL_ID,
          via: "pool",
          pinReleased: null,
        },
      },
      {
        name: "resolved (not listed)",
        pin: null,
        resolution: {
          status: "resolved",
          deviceId: UNLISTED,
          via: "pool",
          pinReleased: null,
        },
      },
    ];
  it.each(cases)("$name", ({ pin, resolution }) => {
    const dispatch = dispatchTargetFrom({
      listState: "loaded",
      runners: listed,
      pin,
      resolution,
    });
    const read = resolveRunnerTarget({
      listState: "loaded",
      runners: listed,
      pinId: pin?.id ?? null,
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
  const resolutions: Res[] = [
    { status: "loading" },
    { status: "resolved", deviceId: LOCAL_ID, via: "pool", pinReleased: null },
    { status: "resolved", deviceId: REMOTE_ID, via: "pin", pinReleased: null },
    { status: "resolved", deviceId: UNLISTED, via: "pool", pinReleased: null },
    {
      status: "resolved",
      deviceId: LOCAL_ID,
      via: "pool",
      pinReleased: { reason: "offline", detail: null },
    },
    {
      status: "pin_ineligible",
      deviceId: REMOTE_ID,
      reason: "drained",
      detail: "drained",
      missingCapabilities: [],
    },
    {
      status: "pin_ineligible",
      deviceId: LOCAL_ID,
      reason: "offline",
      detail: "offline",
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
  const pins: Array<RunnerPin | null> = [
    null,
    { id: REMOTE_ID, name: null },
    { id: LOCAL_ID, name: "this-box" },
    { id: GONE_ID, name: "old-laptop" },
  ];
  const lastResolved = [null, REMOTE_ID, LOCAL_ID];

  it("holds for every status × pick × locality × last-resolved — placeable and machine-bound", () => {
    let allowed = 0;
    let boundAllowed = 0;
    for (const resolution of resolutions)
      for (const runners of lists)
        for (const localityById of localities)
          for (const pin of pins)
            for (const lastResolvedId of lastResolved) {
              const dispatch = dispatchTargetFrom({
                listState: "loaded",
                runners,
                pin,
                resolution,
              });
              const read = resolveRunnerTarget({
                listState: "loaded",
                runners,
                pinId: pin?.id ?? null,
                localityById,
                resolution,
                lastResolvedId,
              });
              if (dispatch.runnerId === null) {
                expect(dispatch.message).toBeTruthy();
              } else {
                allowed += 1;
                expect(read.target).toMatchObject({
                  kind: "runner",
                  runner: { id: dispatch.runnerId },
                });
              }
              for (const bound of resolutions) {
                const out = machineBoundDispatchFrom({
                  runners,
                  pin,
                  placeable: dispatch,
                  resolution: bound,
                });
                if (out.runnerId === null) {
                  expect(out.message).toBeTruthy();
                  continue;
                }
                boundAllowed += 1;
                // Never a device other than the one asked about...
                expect(out.runnerId).toBe(pin?.id ?? dispatch.runnerId);
                // ...and always the one the page's reads address.
                expect(read.target).toMatchObject({
                  kind: "runner",
                  runner: { id: out.runnerId },
                });
              }
            }
    // The sweep actually exercised allowed cases.
    expect(allowed).toBeGreaterThan(0);
    expect(boundAllowed).toBeGreaterThan(0);
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
