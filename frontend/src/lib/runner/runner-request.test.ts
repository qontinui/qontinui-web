/**
 * runnerRequest — the one per-request transport resolver (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 2).
 *
 * A request goes over loopback ONLY for a runner proven to be on this machine,
 * and through the backend relay (`/api/v1/device-bridge/runner-proxy/<path>`
 * with `X-Qontinui-Device-Id`) for every other listed runner — including every
 * runner on a production origin, where the browser cannot reach loopback at
 * all. A path the runner does not relay is refused as a typed "needs the
 * runner on this machine" error.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const relayFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => relayFetch(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));

import {
  RELAY_POLL_INTERVAL_MS,
  RUNNER_LIST_UNAVAILABLE,
  RUNNER_NEEDS_LOCAL,
  RUNNER_RELAY_FAILED,
  RUNNER_SELECTION_REQUIRED,
  RunnerApiError,
  effectivePollInterval,
  isRunnerNeedsLocalError,
  runnerFetch,
  runnerPollDelay,
  runnerPollInterval,
  runnerRequest,
  startRunnerPoll,
  useRunnerQuery,
} from "./api-client";
import {
  RELAY_DEADLINE_MARGIN_MS,
  RELAY_DEFAULT_WAIT_MS,
  RELAY_FLOOR_WAIT_MS,
  relayWaitMs,
} from "./relay";
import { __resetRunnerLocalityCache } from "./locality";
import type { RunnerTarget } from "./target";

const RUNNER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";

const originalLocation = window.location;

function stubOrigin(origin: string) {
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, origin, href: `${origin}/settings` },
    writable: true,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function target(
  locality: "local" | "not_local" | "unknown" | undefined,
  port: number | null = 9877
): RunnerTarget {
  return {
    kind: "runner",
    runner: { id: RUNNER_ID, port, name: "box" },
    locality,
  };
}

/** The runner's own relay-path refusal (qontinui-runner `http_relay_error`). */
const RELAY_PATH_REFUSAL = {
  error:
    "this path is not carried by the HTTP relay — the relay serves a closed set of routes, and terminal creation, input and teardown go through the typed relay frames, which carry the create/attach gate",
};

let loopbackFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stubOrigin("http://localhost:3001");
  __resetRunnerLocalityCache();
  relayFetch.mockReset();
  loopbackFetch = vi.fn().mockResolvedValue(jsonResponse({ via: "loopback" }));
  vi.stubGlobal("fetch", loopbackFetch);
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("runnerRequest chooses the transport per request", () => {
  it("local → loopback on 127.0.0.1:<port>, and never the relay", async () => {
    const res = await runnerRequest(target("local"), "/settings/general");
    expect(await res.json()).toEqual({ via: "loopback" });
    expect(String(loopbackFetch.mock.calls[0]![0])).toBe(
      "http://127.0.0.1:9877/settings/general"
    );
    expect(relayFetch).not.toHaveBeenCalled();
  });

  it("remote → the relay, addressed by device id, with the query intact", async () => {
    relayFetch.mockResolvedValue(jsonResponse({ via: "relay" }));

    const res = await runnerRequest(target("not_local"), "/task-runs?limit=5", {
      timeoutMs: 20_000,
    });

    expect(await res.json()).toEqual({ via: "relay" });
    expect(loopbackFetch).not.toHaveBeenCalled();
    const [url, init] = relayFetch.mock.calls[0] as [
      string,
      RequestInit & { maxRetries?: number },
    ];
    expect(url).toBe(
      "https://api.test/api/v1/device-bridge/runner-proxy/task-runs?limit=5"
    );
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Qontinui-Device-Id"]).toBe(RUNNER_ID);
    expect(headers["X-Qontinui-Timeout-Ms"]).toBe("20000");
    // A relay failure is surfaced once, never retried into a hang.
    expect(init.maxRetries).toBe(0);
  });

  it("unknown (not proven local) → the relay, never loopback", async () => {
    relayFetch.mockResolvedValue(jsonResponse({ via: "relay" }));
    await runnerRequest(target("unknown"), "/health");
    expect(loopbackFetch).not.toHaveBeenCalled();
    expect(relayFetch).toHaveBeenCalledTimes(1);
  });

  it("unmeasured → measures first; a port answering with ANOTHER id relays, never uses that port", async () => {
    loopbackFetch.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).endsWith("/settings/device-info")
        ? jsonResponse({ success: true, data: { device_id: OTHER_ID } })
        : jsonResponse({ via: "loopback" })
    );
    relayFetch.mockResolvedValue(jsonResponse({ via: "relay" }));

    const res = await runnerRequest(target(undefined), "/health");

    expect(await res.json()).toEqual({ via: "relay" });
    const loopbackUrls = loopbackFetch.mock.calls.map((c) => String(c[0]));
    expect(loopbackUrls).toEqual([
      "http://127.0.0.1:9877/settings/device-info",
    ]);
  });

  it("a production origin → every request is a relay request, even for a runner once measured local", async () => {
    stubOrigin("https://app.qontinui.io");
    relayFetch.mockResolvedValue(jsonResponse({ via: "relay" }));

    await runnerRequest(target("local"), "/health");
    await runnerRequest(target(undefined), "/status");

    // Not even the locality probe touches loopback from a public origin.
    expect(loopbackFetch).not.toHaveBeenCalled();
    expect(relayFetch.mock.calls.map((c) => c[0])).toEqual([
      "https://api.test/api/v1/device-bridge/runner-proxy/health",
      "https://api.test/api/v1/device-bridge/runner-proxy/status",
    ]);
  });

  it("a FormData body keeps its multipart Content-Type over the relay", async () => {
    relayFetch.mockResolvedValue(jsonResponse({}));
    const form = new FormData();
    form.append("file", new Blob(["x"]), "x.png");

    await runnerRequest(target("not_local"), "/upload", {
      method: "POST",
      body: form,
    });

    const init = relayFetch.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["Content-Type"]).toMatch(
      /^multipart\/form-data; boundary=/
    );
    expect(init.body).toBeInstanceOf(ArrayBuffer);
  });

  it("no route → typed refusal, and nothing is sent", async () => {
    const list = await runnerRequest(
      { kind: "unavailable", reason: "list_unavailable" },
      "/health"
    ).catch((e: unknown) => e);
    const choice = await runnerRequest(
      { kind: "unavailable", reason: "selection_required" },
      "/health"
    ).catch((e: unknown) => e);

    expect((list as RunnerApiError).code).toBe(RUNNER_LIST_UNAVAILABLE);
    expect((choice as RunnerApiError).code).toBe(RUNNER_SELECTION_REQUIRED);
    expect(loopbackFetch).not.toHaveBeenCalled();
    expect(relayFetch).not.toHaveBeenCalled();
  });
});

describe("a path the relay does not carry", () => {
  it("is a typed RUNNER_NEEDS_LOCAL error naming the machine requirement", async () => {
    relayFetch.mockResolvedValue(jsonResponse(RELAY_PATH_REFUSAL, 403));

    const err = await runnerRequest(
      target("not_local"),
      "/capture-screenshot",
      { method: "POST" }
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RunnerApiError);
    expect((err as RunnerApiError).code).toBe(RUNNER_NEEDS_LOCAL);
    expect(isRunnerNeedsLocalError(err)).toBe(true);
    expect((err as RunnerApiError).message).toMatch(
      /needs the runner on this machine/
    );
    expect((err as RunnerApiError).message).toContain('"box"');
    expect((err as RunnerApiError).message).toContain("/capture-screenshot");
  });

  it("is the same typed error through runnerFetch", async () => {
    relayFetch.mockResolvedValue(jsonResponse(RELAY_PATH_REFUSAL, 403));
    const err = await runnerFetch(target("not_local"), "/files/write").catch(
      (e: unknown) => e
    );
    expect((err as RunnerApiError).code).toBe(RUNNER_NEEDS_LOCAL);
  });

  it("an unrelated relayed 403 is returned as a response, not mislabelled", async () => {
    relayFetch.mockResolvedValue(jsonResponse({ error: "forbidden" }, 403));
    const res = await runnerRequest(target("not_local"), "/settings/ai");
    expect(res.status).toBe(403);
  });

  it("useRunnerQuery reports it with its code and stops polling that path", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    relayFetch.mockImplementation(async () =>
      jsonResponse(RELAY_PATH_REFUSAL, 403)
    );

    const { result, unmount } = renderHook(() =>
      useRunnerQuery(target("not_local"), "/hooks", { pollInterval: 5000 })
    );
    await waitFor(() =>
      expect(result.current.errorCode).toBe(RUNNER_NEEDS_LOCAL)
    );
    expect(result.current.isOffline).toBe(false);
    expect(result.current.error).toMatch(/needs the runner on this machine/);

    const calls = relayFetch.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELAY_POLL_INTERVAL_MS * 3);
    });
    expect(relayFetch.mock.calls.length).toBe(calls);
    unmount();
  });
});

describe("relay-layer failures", () => {
  it("a relay 503 carries the backend's diagnostics and reads as offline", async () => {
    relayFetch.mockImplementation(async () =>
      jsonResponse(
        {
          detail: "runner not connected",
          device_id: RUNNER_ID,
          ws_connected_at: null,
          request_id: "req-1",
        },
        503
      )
    );
    const err = (await runnerFetch(target("not_local"), "/health").catch(
      (e: unknown) => e
    )) as RunnerApiError;
    expect(err.code).toBe(RUNNER_RELAY_FAILED);
    expect(err.status).toBe(503);
    expect(err.relayDiagnostics?.wsConnectedAt).toBeNull();
    expect(err.message).toContain("runner not connected");
    expect(err.message).toContain("req-1");

    const { result, unmount } = renderHook(() =>
      useRunnerQuery(target("not_local"), "/health")
    );
    await waitFor(() => expect(result.current.isOffline).toBe(true));
    unmount();
  });
});

describe("relay poll cadence", () => {
  it("a relayed poll never runs faster than RELAY_POLL_INTERVAL_MS", () => {
    expect(
      effectivePollInterval({ kind: "relay", runnerId: RUNNER_ID }, 2000)
    ).toBe(RELAY_POLL_INTERVAL_MS);
    expect(
      effectivePollInterval(
        {
          kind: "loopback",
          base: "http://127.0.0.1:9877",
          runnerId: RUNNER_ID,
        },
        2000
      )
    ).toBe(2000);
    expect(
      effectivePollInterval({ kind: "relay", runnerId: RUNNER_ID }, 0)
    ).toBe(0);
  });

  it("useRunnerQuery over the relay polls at the relay cadence, not the requested one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    relayFetch.mockImplementation(async () => jsonResponse({ ok: true }));

    const { result, unmount } = renderHook(() =>
      useRunnerQuery(target("not_local"), "/status", { pollInterval: 1000 })
    );
    await waitFor(() => expect(result.current.data).toEqual({ ok: true }));
    const afterFirst = relayFetch.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELAY_POLL_INTERVAL_MS - 1000);
    });
    expect(relayFetch.mock.calls.length).toBe(afterFirst);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(relayFetch.mock.calls.length).toBe(afterFirst + 1);
    unmount();
  });
});

describe("one deadline concept over the relay", () => {
  function relayInit(): RequestInit & { timeoutMs?: number } {
    return relayFetch.mock.calls[0]![1] as RequestInit & { timeoutMs?: number };
  }
  function waitHeader(): string {
    return (relayInit().headers as Record<string, string>)[
      "X-Qontinui-Timeout-Ms"
    ]!;
  }

  it("a budget becomes the relay wait, with the client deadline RELAY_DEADLINE_MARGIN_MS beyond it", async () => {
    relayFetch.mockResolvedValue(jsonResponse({}));
    await runnerRequest(target("not_local"), "/command", {
      timeoutMs: 120_000,
    });
    expect(waitHeader()).toBe("120000");
    expect(relayInit().timeoutMs).toBe(120_000 + RELAY_DEADLINE_MARGIN_MS);
  });

  it("a short loopback-sized budget is floored for the relay (relay-aware health checks)", async () => {
    relayFetch.mockResolvedValue(jsonResponse({}));
    await runnerRequest(target("not_local"), "/status", { timeoutMs: 2000 });
    expect(waitHeader()).toBe(String(RELAY_FLOOR_WAIT_MS));
  });

  it("no budget still sends the wait explicitly (the backend default), never silently", async () => {
    relayFetch.mockResolvedValue(jsonResponse({}));
    await runnerRequest(target("not_local"), "/status");
    expect(waitHeader()).toBe(String(RELAY_DEFAULT_WAIT_MS));
  });

  it("relayWaitMs clamps to the backend's [1 s, 120 s]", () => {
    expect(relayWaitMs(10 * 60_000)).toBe(120_000);
    expect(relayWaitMs(0)).toBe(RELAY_FLOOR_WAIT_MS);
  });

  it("runnerFetch's own deadline outlasts the relay wait, so the backend's 504 wins", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    // The relay answers the backend's structured 504 exactly at the wait.
    relayFetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(
            () =>
              resolve(
                jsonResponse({ detail: "runner did not respond in time" }, 504)
              ),
            20_000
          )
        )
    );
    const call = runnerFetch(target("not_local"), "/slow", {
      timeoutMs: 20_000,
    }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_001);
    const err = (await call) as RunnerApiError;
    expect(err.status).toBe(504);
    expect(err.code).toBe(RUNNER_RELAY_FAILED);
    expect(err.message).toContain("runner did not respond in time");
  });

  it("a caller's signal also aborts route resolution", async () => {
    const controller = new AbortController();
    const pending: RunnerTarget = {
      kind: "pending",
      settle: () => new Promise<RunnerTarget>(() => {}),
    };
    const call = runnerRequest(pending, "/health", {
      signal: controller.signal,
    }).catch((e: unknown) => e);
    controller.abort(new DOMException("cancelled", "AbortError"));
    const err = await call;
    expect((err as DOMException).name).toBe("AbortError");
    expect(relayFetch).not.toHaveBeenCalled();
    expect(loopbackFetch).not.toHaveBeenCalled();
  });
});

describe("the one poll helper", () => {
  it("polls at the requested cadence only over loopback; relay AND unresolved targets at relay speed", () => {
    expect(runnerPollInterval(target("local"), 2000)).toBe(2000);
    expect(runnerPollInterval(target("not_local"), 2000)).toBe(
      RELAY_POLL_INTERVAL_MS
    );
    expect(runnerPollInterval(target(undefined), 2000)).toBe(
      RELAY_POLL_INTERVAL_MS
    );
    expect(runnerPollInterval({ kind: "pending" }, 2000)).toBe(
      RELAY_POLL_INTERVAL_MS
    );
    expect(
      runnerPollInterval(
        { kind: "unavailable", reason: "selection_required" },
        2000
      )
    ).toBe(RELAY_POLL_INTERVAL_MS);
  });

  it("startRunnerPoll re-evaluates the cadence on every tick", async () => {
    vi.useFakeTimers();
    let current = target("local");
    const tick = vi.fn();
    const stop = startRunnerPoll({
      getTarget: () => current,
      requestedMs: 1000,
      tick,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    current = target("not_local");
    // The tick already scheduled at loopback speed fires; the NEXT one is
    // scheduled at relay speed.
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RELAY_POLL_INTERVAL_MS - 1);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it("startRunnerPoll stops for good on RUNNER_NEEDS_LOCAL and reports it", async () => {
    vi.useFakeTimers();
    const refusal = new RunnerApiError(
      403,
      "needs the runner on this machine",
      undefined,
      {
        code: RUNNER_NEEDS_LOCAL,
      }
    );
    const tick = vi.fn().mockRejectedValue(refusal);
    const onNeedsLocal = vi.fn();
    const onError = vi.fn();
    startRunnerPoll({
      getTarget: () => target("not_local"),
      requestedMs: 1000,
      tick,
      onNeedsLocal,
      onError,
      immediate: true,
    });
    await vi.advanceTimersByTimeAsync(RELAY_POLL_INTERVAL_MS * 3);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(onNeedsLocal).toHaveBeenCalledWith(refusal);
    expect(onError).not.toHaveBeenCalled();
  });

  it("startRunnerPoll keeps polling through other errors", async () => {
    vi.useFakeTimers();
    const tick = vi.fn().mockRejectedValue(new Error("blip"));
    const onError = vi.fn();
    const stop = startRunnerPoll({
      getTarget: () => target("local"),
      requestedMs: 1000,
      tick,
      onError,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(3);
    stop();
  });

  it("runnerPollDelay waits the relay cadence for a relayed target", async () => {
    vi.useFakeTimers();
    let done = false;
    void runnerPollDelay(target("not_local"), 1000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(RELAY_POLL_INTERVAL_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});

describe("follow-up guards", () => {
  it("startRunnerPoll with a non-positive interval never ticks and returns a no-op stop", async () => {
    vi.useFakeTimers();
    for (const requestedMs of [0, -1, Number.NaN]) {
      const tick = vi.fn();
      const stop = startRunnerPoll({
        getTarget: () => target("local"),
        requestedMs,
        tick,
        immediate: true,
      });
      await vi.advanceTimersByTimeAsync(RELAY_POLL_INTERVAL_MS * 2);
      expect(tick).not.toHaveBeenCalled();
      expect(() => stop()).not.toThrow();
    }
  });

  it("a loopback budget also bounds the caller's BODY read (headers, then a stalled body)", async () => {
    loopbackFetch.mockImplementation(
      (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("aborted", "AbortError"))
            );
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      }
    );

    const started = Date.now();
    const res = await runnerRequest(target("local"), "/status", {
      timeoutMs: 50,
    });
    const err = await res.text().catch((e: unknown) => e);
    expect((err as DOMException).name).toBe("AbortError");
    expect(Date.now() - started).toBeLessThan(2000);
  }, 3000);
});
