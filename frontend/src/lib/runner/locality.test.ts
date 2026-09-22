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

  it("stays measuring while the runner list is loading, whatever is stored", () => {
    expect(
      resolveRunnerTarget({
        listState: "loading",
        runners: [],
        selectedId: REMOTE_ID,
        localityById: new Map(),
      })
    ).toEqual({
      activeRunner: null,
      target: { kind: "pending" },
      autoLocalId: null,
    });
  });

  it("a FAILED list load is not an empty fleet: list_unavailable, never the default base", () => {
    expect(
      resolveRunnerTarget({
        listState: "failed",
        runners: [],
        selectedId: REMOTE_ID,
        localityById: new Map(),
      }).target
    ).toEqual({ kind: "unavailable", reason: "list_unavailable" });
  });

  it("the sticky auto-selection stays active across an unknown re-measure", () => {
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote, local],
      selectedId: null,
      stickyAutoId: LOCAL_ID,
      localityById: new Map<string, "not_local" | "unknown">([
        [REMOTE_ID, "not_local"],
        [LOCAL_ID, "unknown"],
      ]),
    });
    expect(resolution.activeRunner?.id).toBe(LOCAL_ID);
    // Unknown is not local: the sticky runner is reached by id over the relay.
    expect(routeOfTarget(resolution.target)).toMatchObject({
      kind: "relay",
      runnerId: LOCAL_ID,
    });
  });

  it("the sticky auto-selection yields to ANOTHER runner proven local while it is itself unknown", () => {
    const sibling = runner("55555555-5555-4555-8555-555555555555", 9877);
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote, local, sibling],
      selectedId: null,
      stickyAutoId: LOCAL_ID,
      localityById: new Map<string, "not_local" | "unknown" | "local">([
        [REMOTE_ID, "not_local"],
        [LOCAL_ID, "unknown"],
        [sibling.id, "local"],
      ]),
    });
    expect(resolution.activeRunner?.id).toBe(sibling.id);
    expect(routeOfTarget(resolution.target)).toEqual({
      kind: "loopback",
      base: "http://127.0.0.1:9877",
      runnerId: sibling.id,
    });
  });

  it("the sticky auto-selection moves on a definite not_local", () => {
    const other = runner("44444444-4444-4444-8444-444444444444", 9879);
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote, local, other],
      selectedId: null,
      stickyAutoId: LOCAL_ID,
      localityById: new Map<string, "not_local" | "local">([
        [REMOTE_ID, "not_local"],
        [LOCAL_ID, "not_local"],
        [other.id, "local"],
      ]),
    });
    expect(resolution.activeRunner?.id).toBe(other.id);
    expect(resolution.autoLocalId).toBe(other.id);
  });

  it("a loaded, empty list keeps the default local base", () => {
    expect(
      resolveRunnerTarget({
        listState: "loaded",
        runners: [],
        selectedId: null,
        localityById: new Map(),
      }).target
    ).toEqual({ kind: "default_local" });
  });

  it("auto-select stays measuring while a runner is unmeasured, even if runners[0] is already not_local", () => {
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote, local],
      selectedId: null,
      localityById: new Map([[REMOTE_ID, "not_local"]]),
    });
    expect(resolution.target.kind).toBe("pending");
  });

  it("auto-select picks the proven-local runner over runners[0]", () => {
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote, local],
      selectedId: null,
      localityById: new Map([[LOCAL_ID, "local"]]),
    });
    expect(resolution.activeRunner?.id).toBe(LOCAL_ID);
    expect(routeOfTarget(resolution.target)).toEqual({
      kind: "loopback",
      base: `http://127.0.0.1:${PORT}`,
      runnerId: LOCAL_ID,
    });
  });

  it("auto-select among SEVERAL runners, none local, requires a choice — it never relays to runners[0]", () => {
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote, local],
      selectedId: null,
      localityById: new Map<string, "not_local" | "unknown">([
        [REMOTE_ID, "not_local"],
        [LOCAL_ID, "unknown"],
      ]),
    });
    expect(resolution.target).toEqual({
      kind: "unavailable",
      reason: "selection_required",
    });
  });

  it("a SOLE runner, not local, is the target and is reached over the relay (the production-origin case)", () => {
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote],
      selectedId: null,
      localityById: new Map([[REMOTE_ID, "unknown"]]),
    });
    expect(resolution.activeRunner?.id).toBe(REMOTE_ID);
    expect(routeOfTarget(resolution.target)).toMatchObject({
      kind: "relay",
      runnerId: REMOTE_ID,
    });
  });

  it("an explicit remote selection is honoured over the relay, not swapped for the local runner", () => {
    const resolution = resolveRunnerTarget({
      listState: "loaded",
      runners: [remote, local],
      selectedId: REMOTE_ID,
      localityById: new Map([
        [REMOTE_ID, "not_local"],
        [LOCAL_ID, "local"],
      ]),
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
