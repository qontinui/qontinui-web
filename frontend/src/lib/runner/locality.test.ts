/**
 * Regression tests for the wrong-box defect (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 1).
 *
 * BUG: the runner list is fleet-wide, but the base-URL builder kept only a
 * runner's PORT and pointed it at localhost. Selecting a runner on another
 * machine therefore sent every `runnerFetch` to that port on THIS box — a
 * connect-refusal, or a silent hit on whatever local process owns the port
 * (typically this machine's own runner on :9876, answering as if it were the
 * remote one).
 *
 * FIX: a runner gets a loopback base only when 127.0.0.1:<port>
 * `/settings/device-info` answers with the runner's OWN id. Anything else is
 * `not_local` or `unknown`, has no loopback base, and (Phase 2) is reached
 * through the backend relay by its device id — never over loopback.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import type { Runner } from "@qontinui/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedRunnerState } from "./resolve";

const relayFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => relayFetch(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));

import {
  buildRunnerTarget,
  resolveRunnerTarget,
} from "@/contexts/active-runner-context";
import {
  RUNNER_LOCALITY_UNKNOWN,
  RunnerApiError,
  runnerFetch,
} from "./api-client";
import {
  DEFAULT_RUNNER_BASE,
  routeOfTarget,
  type RunnerTarget,
} from "./target";
import {
  __resetRunnerLocalityCache,
  isRunnerLocal,
  LOCAL_RECHECK_BACKOFF_MS,
  measureRunnerLocality,
  peekRunnerLocality,
  useRunnerLocality,
} from "./locality";

const REMOTE_ID = "11111111-1111-4111-8111-111111111111";
const LOCAL_ID = "22222222-2222-4222-8222-222222222222";
const PORT = 9876;

const originalLocation = window.location;

function stubOrigin(origin: string) {
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, origin, href: `${origin}/build/workflows` },
    writable: true,
  });
}

function runner(id: string, port: number | null = PORT): Runner {
  return {
    id,
    name: id === REMOTE_ID ? "remote-box" : "this-box",
    port,
    capabilities: [],
    createdAt: "2026-09-20T00:00:00Z",
    derivedStatus: "healthy",
  } as unknown as Runner;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A fetch standing in for THIS machine: whatever listens on 127.0.0.1:PORT
 * identifies itself as `answeringId`, and answers every other path 200 — the
 * silent wrong-box hit the defect produced.
 */
function stubLocalPortOwner(answeringId: string) {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/settings/device-info")) {
      return jsonResponse({
        success: true,
        data: { device_id: answeringId, device_name: "x", platform: "linux" },
      });
    }
    return jsonResponse({ ok: true, answeredBy: answeringId });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function nonProbeCalls(fetchSpy: ReturnType<typeof vi.fn>): string[] {
  return fetchSpy.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => !url.endsWith("/settings/device-info"));
}

describe("wrong-box defect: a remote runner never gets a loopback base", () => {
  beforeEach(() => {
    stubOrigin("http://localhost:3001");
    __resetRunnerLocalityCache();
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
    relayFetch.mockReset();
    vi.unstubAllGlobals();
  });

  it("a remote runner whose port answers with a DIFFERENT id is not_local, has no base, and runnerFetch goes to the relay — never localhost", async () => {
    // The remote runner (REMOTE_ID) reports port 9876; on this box 9876 is
    // owned by this machine's own runner (LOCAL_ID).
    const fetchSpy = stubLocalPortOwner(LOCAL_ID);
    relayFetch.mockResolvedValue(jsonResponse({ ok: true, via: "relay" }));
    const remote = runner(REMOTE_ID);

    const locality = await isRunnerLocal(remote);
    expect(locality).toBe("not_local");
    expect(routeOfTarget(buildRunnerTarget(remote, locality)).kind).not.toBe(
      "loopback"
    );

    await expect(
      runnerFetch(buildRunnerTarget(remote, locality), "/health")
    ).resolves.toEqual({ ok: true, via: "relay" });

    expect(nonProbeCalls(fetchSpy)).toEqual([]);
    expect(relayFetch).toHaveBeenCalledTimes(1);
    const [url, init] = relayFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.test/api/v1/device-bridge/runner-proxy/health"
    );
    expect(
      (init.headers as Record<string, string>)["X-Qontinui-Device-Id"]
    ).toBe(REMOTE_ID);
  });

  it("the probe is spelled 127.0.0.1, not localhost", async () => {
    const fetchSpy = stubLocalPortOwner(LOCAL_ID);
    await isRunnerLocal(runner(LOCAL_ID));
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      `http://127.0.0.1:${PORT}/settings/device-info`
    );
  });

  it("a runner whose port answers with its OWN id is local and is fetched over loopback", async () => {
    const fetchSpy = stubLocalPortOwner(LOCAL_ID);
    const local = runner(LOCAL_ID);

    const locality = await isRunnerLocal(local);
    expect(locality).toBe("local");
    expect(routeOfTarget(buildRunnerTarget(local, locality))).toMatchObject({
      kind: "loopback",
      base: `http://127.0.0.1:${PORT}`,
    });

    await expect(
      runnerFetch(buildRunnerTarget(local, locality), "/health")
    ).resolves.toMatchObject({ ok: true });
    expect(nonProbeCalls(fetchSpy)).toEqual([
      `http://127.0.0.1:${PORT}/health`,
    ]);
    expect(relayFetch).not.toHaveBeenCalled();
  });

  it("the id comparison ignores UUID case", async () => {
    stubLocalPortOwner(LOCAL_ID.toUpperCase());
    await expect(isRunnerLocal(runner(LOCAL_ID))).resolves.toBe("local");
  });
});

describe("isRunnerLocal three states", () => {
  beforeEach(() => {
    stubOrigin("http://localhost:3001");
    __resetRunnerLocalityCache();
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a failed connect is unknown — the browser cannot tell refused from a CORS block", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );
    await expect(isRunnerLocal(runner(REMOTE_ID))).resolves.toBe("unknown");
  });

  it("no port is unknown, and nothing is probed", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(isRunnerLocal(runner(LOCAL_ID, null))).resolves.toBe(
      "unknown"
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a page origin that cannot reach loopback is unknown, and nothing is probed", async () => {
    stubOrigin("https://qontinui.io");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(isRunnerLocal(runner(LOCAL_ID))).resolves.toBe("unknown");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a non-2xx answer is unknown (e.g. a runner build predating the route)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 404))
    );
    await expect(isRunnerLocal(runner(LOCAL_ID))).resolves.toBe("unknown");
  });

  it("an unparseable or id-less answer is unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>", { status: 200 }))
    );
    await expect(isRunnerLocal(runner(LOCAL_ID))).resolves.toBe("unknown");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: {} }))
    );
    await expect(isRunnerLocal(runner(LOCAL_ID))).resolves.toBe("unknown");
  });

  it("a probe that times out is unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          })
      )
    );
    await expect(isRunnerLocal(runner(LOCAL_ID), 10)).resolves.toBe("unknown");
  });

  it("an unknown locality yields no loopback base (never collapsed into local)", () => {
    const r = runner(LOCAL_ID);
    // Unknown relays by device id; unmeasured has no route yet.
    expect(routeOfTarget(buildRunnerTarget(r, "unknown"))).toMatchObject({
      kind: "relay",
      runnerId: LOCAL_ID,
    });
    expect(routeOfTarget(buildRunnerTarget(r, undefined))).toEqual({
      kind: "measuring",
    });
  });
});

describe("resolveRunnerTarget", () => {
  const remote = runner(REMOTE_ID, 9877);
  const local = runner(LOCAL_ID, PORT);
  const LOADING: ResolvedRunnerState = { status: "loading" };
  const DOWN: ResolvedRunnerState = {
    status: "unavailable",
    reason: "not_deployed",
    httpStatus: 404,
    code: null,
  };
  const resolvedTo = (deviceId: string): ResolvedRunnerState => ({
    status: "resolved",
    deviceId,
    via: "pool",
    pinReleased: null,
  });

  it("stays measuring while the runner list is loading, whatever is stored", () => {
    expect(
      resolveRunnerTarget({
        listState: "loading",
        runners: [],
        pinId: REMOTE_ID,
        localityById: new Map(),
        resolution: resolvedTo(REMOTE_ID),
      })
    ).toEqual({
      activeRunner: null,
      target: { kind: "pending" },
    });
  });

  it("a FAILED list load is not an empty fleet: list_unavailable, never the default base", () => {
    expect(
      resolveRunnerTarget({
        listState: "failed",
        runners: [],
        pinId: REMOTE_ID,
        localityById: new Map(),
        resolution: LOADING,
      }).target
    ).toEqual({ kind: "unavailable", reason: "list_unavailable" });
  });

  it("a loaded, empty list keeps the default local base", () => {
    expect(
      resolveRunnerTarget({
        listState: "loaded",
        runners: [],
        pinId: null,
        localityById: new Map(),
        resolution: LOADING,
      }).target
    ).toEqual({ kind: "default_local" });
  });

  it("auto: coord's resolved device is the target — over the local runner AND runners[0]", () => {
    const third = runner("66666666-6666-4666-8666-666666666666", 9878);
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [local, remote, third],
      pinId: null,
      localityById: new Map<string, "local" | "not_local">([
        [LOCAL_ID, "local"],
        [REMOTE_ID, "not_local"],
        [third.id, "not_local"],
      ]),
      resolution: resolvedTo(third.id),
    });
    expect(resolution.activeRunner?.id).toBe(third.id);
    expect(routeOfTarget(resolution.target)).toMatchObject({
      kind: "relay",
      runnerId: third.id,
    });
  });

  it("auto: a resolved device the list has not caught up with is relayed to by id", () => {
    const unlisted = "77777777-7777-4777-8777-777777777777";
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote],
      pinId: null,
      localityById: new Map(),
      resolution: resolvedTo(unlisted),
    });
    expect(resolution.activeRunner).toBeNull();
    expect(routeOfTarget(resolution.target)).toEqual({
      kind: "relay",
      runnerId: unlisted,
      runnerName: undefined,
    });
  });

  it("auto: a SOLE listed runner is the target before coord has answered", () => {
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote],
      pinId: null,
      localityById: new Map([[REMOTE_ID, "unknown"]]),
      resolution: LOADING,
    });
    expect(resolution.activeRunner?.id).toBe(REMOTE_ID);
    expect(routeOfTarget(resolution.target)).toMatchObject({
      kind: "relay",
      runnerId: REMOTE_ID,
    });
  });

  it("auto: with several runners, waits (pending) for the resolver's first answer", () => {
    expect(
      resolveRunnerTarget({
        listState: "loaded",
        runners: [local, remote],
        pinId: null,
        localityById: new Map([[LOCAL_ID, "local"]]),
        resolution: LOADING,
      }).target.kind
    ).toBe("pending");
  });

  it("auto, resolver UNKNOWN: keeps the last resolved device", () => {
    for (const unknown of [DOWN, { status: "drain_unreadable" } as const]) {
      const resolution = resolveRunnerTarget({
        listState: "loaded",
        runners: [local, remote],
        pinId: null,
        localityById: new Map([[LOCAL_ID, "local"]]),
        resolution: unknown,
        lastResolvedId: REMOTE_ID,
      });
      expect(resolution.activeRunner?.id).toBe(REMOTE_ID);
    }
  });

  it("auto, resolver UNKNOWN, nothing resolved yet: a runner proven local — not runners[0]", () => {
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote, local],
      pinId: null,
      localityById: new Map<string, "local" | "not_local">([
        [REMOTE_ID, "not_local"],
        [LOCAL_ID, "local"],
      ]),
      resolution: DOWN,
    });
    expect(resolution.activeRunner?.id).toBe(LOCAL_ID);
    expect(routeOfTarget(resolution.target)).toEqual({
      kind: "loopback",
      base: `http://127.0.0.1:${PORT}`,
      runnerId: LOCAL_ID,
    });
  });

  it("auto, resolver UNKNOWN: stays pending while a runner is unmeasured", () => {
    expect(
      resolveRunnerTarget({
        listState: "loaded",
        runners: [remote, local],
        pinId: null,
        localityById: new Map([[REMOTE_ID, "not_local"]]),
        resolution: DOWN,
      }).target.kind
    ).toBe("pending");
  });

  it("auto, resolver UNKNOWN, several runners, nothing to keep: resolver_unavailable — NEVER runners[0]", () => {
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote, local],
      pinId: null,
      localityById: new Map<string, "not_local" | "unknown">([
        [REMOTE_ID, "unknown"],
        [LOCAL_ID, "not_local"],
      ]),
      resolution: DOWN,
    });
    expect(resolution.activeRunner).toBeNull();
    expect(resolution.target).toEqual({
      kind: "unavailable",
      reason: "resolver_unavailable",
    });
  });

  it("auto, resolver UNKNOWN: a SOLE runner, not local, is still the target (not an order-based pick)", () => {
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote],
      pinId: null,
      localityById: new Map([[REMOTE_ID, "unknown"]]),
      resolution: DOWN,
    });
    expect(resolution.activeRunner?.id).toBe(REMOTE_ID);
    expect(routeOfTarget(resolution.target)).toMatchObject({
      kind: "relay",
      runnerId: REMOTE_ID,
    });
  });

  const NOTHING_ELIGIBLE = [
    {
      status: "no_capable",
      missing: [],
      onlineDevices: 0,
      pinReleased: null,
    },
    { status: "all_drained", pinReleased: null },
    {
      status: "pin_ineligible",
      deviceId: REMOTE_ID,
      reason: "drained",
      detail: "drained",
      missingCapabilities: [],
    },
  ] as ResolvedRunnerState[];

  it("auto, 'nothing eligible for new work': READS keep last resolved, then proven local, then the sole runner", () => {
    for (const none of NOTHING_ELIGIBLE) {
      expect(
        resolveRunnerTarget({
          listState: "loaded",
          runners: [local, remote],
          pinId: null,
          localityById: new Map([[LOCAL_ID, "local"]]),
          resolution: none,
          lastResolvedId: REMOTE_ID,
        }).activeRunner?.id
      ).toBe(REMOTE_ID);
      expect(
        resolveRunnerTarget({
          listState: "loaded",
          runners: [remote, local],
          pinId: null,
          localityById: new Map<string, "local" | "not_local">([
            [REMOTE_ID, "not_local"],
            [LOCAL_ID, "local"],
          ]),
          resolution: none,
        }).activeRunner?.id
      ).toBe(LOCAL_ID);
      expect(
        resolveRunnerTarget({
          listState: "loaded",
          runners: [remote],
          pinId: null,
          localityById: new Map([[REMOTE_ID, "not_local"]]),
          resolution: none,
        }).activeRunner?.id
      ).toBe(REMOTE_ID);
    }
  });

  it("auto, 'nothing eligible' with nothing to keep: no_eligible_runner, never runners[0]", () => {
    for (const none of NOTHING_ELIGIBLE) {
      const resolution = resolveRunnerTarget({
        listState: "loaded",
        runners: [remote, local],
        pinId: null,
        localityById: new Map<string, "not_local">([
          [REMOTE_ID, "not_local"],
          [LOCAL_ID, "not_local"],
        ]),
        resolution: none,
      });
      expect(resolution.activeRunner).toBeNull();
      expect(resolution.target).toEqual({
        kind: "unavailable",
        reason: "no_eligible_runner",
      });
    }
  });

  it("a remote pick is a preference: coord's device is the target, whatever was picked", () => {
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote, local],
      pinId: REMOTE_ID,
      localityById: new Map([
        [REMOTE_ID, "not_local"],
        [LOCAL_ID, "local"],
      ]),
      resolution: resolvedTo(LOCAL_ID),
    });
    expect(resolution.activeRunner?.id).toBe(LOCAL_ID);
  });

  it("a remote pick is read over the relay while coord names no device", () => {
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote, local],
      pinId: REMOTE_ID,
      localityById: new Map([
        [REMOTE_ID, "not_local"],
        [LOCAL_ID, "local"],
      ]),
      resolution: {
        status: "unavailable",
        reason: "coord_unreachable",
        httpStatus: null,
        code: null,
      },
    });
    expect(resolution.activeRunner?.id).toBe(REMOTE_ID);
    expect(routeOfTarget(resolution.target)).toMatchObject({
      kind: "relay",
      runnerId: REMOTE_ID,
    });
  });
});

describe("runnerFetch for a pending target", () => {
  beforeEach(() => {
    stubOrigin("http://localhost:3001");
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for the provider to settle, then fetches the proven-local base", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchSpy);
    let settleWith: (t: RunnerTarget) => void = () => {};
    const pending: RunnerTarget = {
      kind: "pending",
      settle: () =>
        new Promise<RunnerTarget>((resolve) => {
          settleWith = resolve;
        }),
    };

    const call = runnerFetch(pending, "/health");
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
    settleWith(buildRunnerTarget(runner(LOCAL_ID, 9877), "local"));

    await expect(call).resolves.toEqual({ ok: true });
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      "http://127.0.0.1:9877/health"
    );
  });

  it("refuses as locality-unknown when nothing settles it", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const pending: RunnerTarget = {
      kind: "pending",
      settle: async () => ({ kind: "pending" }),
    };

    const err = await runnerFetch(pending, "/health").catch((e: unknown) => e);
    expect((err as RunnerApiError).code).toBe(RUNNER_LOCALITY_UNKNOWN);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(relayFetch).not.toHaveBeenCalled();
  });

  it("the empty-list default is the default loopback base", () => {
    expect(routeOfTarget({ kind: "default_local" })).toEqual({
      kind: "loopback",
      base: DEFAULT_RUNNER_BASE,
      runnerId: null,
    });
  });
});

describe("measurement sharing", () => {
  beforeEach(() => {
    stubOrigin("http://localhost:3001");
    __resetRunnerLocalityCache();
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("an inconclusive re-probe of a proven-local runner is retried once, holding local meanwhile", async () => {
    vi.useFakeTimers();
    const r = runner(LOCAL_ID);
    stubLocalPortOwner(LOCAL_ID);
    await expect(measureRunnerLocality(r)).resolves.toBe("local");

    // Re-probe: first attempt fails, the retry answers with the same id.
    const answers = [
      () => Promise.reject(new TypeError("Failed to fetch")),
      () =>
        Promise.resolve(
          jsonResponse({ success: true, data: { device_id: LOCAL_ID } })
        ),
    ];
    const fetchSpy = vi.fn(() => answers.shift()!());
    vi.stubGlobal("fetch", fetchSpy);

    const pending = measureRunnerLocality(r, { force: true });
    await vi.advanceTimersByTimeAsync(0);
    // Mid-retry: the earlier proof still stands.
    expect(peekRunnerLocality(r)).toBe("local");
    await vi.advanceTimersByTimeAsync(LOCAL_RECHECK_BACKOFF_MS);
    await expect(pending).resolves.toBe("local");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("a second inconclusive answer IS published as unknown (bounded trust, not unknown-as-local)", async () => {
    vi.useFakeTimers();
    const r = runner(LOCAL_ID);
    stubLocalPortOwner(LOCAL_ID);
    await measureRunnerLocality(r);

    const fetchSpy = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchSpy);
    const pending = measureRunnerLocality(r, { force: true });
    await vi.advanceTimersByTimeAsync(LOCAL_RECHECK_BACKOFF_MS);
    await expect(pending).resolves.toBe("unknown");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("a runner never proven local is not retried", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(measureRunnerLocality(runner(LOCAL_ID))).resolves.toBe(
      "unknown"
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("concurrent and repeat measurements of one (id, port) share one probe", async () => {
    const fetchSpy = stubLocalPortOwner(LOCAL_ID);
    const r = runner(LOCAL_ID);
    const [a, b] = await Promise.all([
      measureRunnerLocality(r),
      measureRunnerLocality(r),
    ]);
    await measureRunnerLocality(r);
    expect([a, b]).toEqual(["local", "local"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("useRunnerLocality reports each runner's measured locality, absent until measured", async () => {
    stubLocalPortOwner(LOCAL_ID);
    const runners = [runner(REMOTE_ID), runner(LOCAL_ID, PORT)];
    const { result } = renderHook(() => useRunnerLocality(runners));

    expect(result.current.get(REMOTE_ID)).toBeUndefined();
    await waitFor(() => {
      expect(result.current.get(REMOTE_ID)).toBe("not_local");
      expect(result.current.get(LOCAL_ID)).toBe("local");
    });
    await act(async () => {});
  });
});
