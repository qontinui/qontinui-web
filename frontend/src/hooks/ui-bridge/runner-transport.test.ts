/**
 * The UI Bridge exploration / recording helpers name their runner by TARGET
 * and go through the resolver (`runnerRequest`): loopback only for a runner
 * proven local, the backend relay for any other. None of their routes is
 * carried by the relay, so a runner on another machine must come back as the
 * typed RUNNER_NEEDS_LOCAL failure — never a raw fetch to an address the
 * runner reported (the runner binds 127.0.0.1 only; such a URL never answers
 * and proves nothing about which machine would).
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runner } from "@qontinui/shared-types";

const relayFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => relayFetch(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));

import { RUNNER_NEEDS_LOCAL, type RunnerTarget } from "@/lib/runner";
import { __resetRunnerLocalityCache } from "@/lib/runner/locality";
import { sendRunnerCommand } from "./utils";
import { runnerTargetById } from "./runnerTargetById";
import { useExplorationStrategy } from "./useExplorationStrategy";
import { useUIBridgeRecording } from "@/hooks/useUIBridgeRecording";
import { DEFAULT_EXPLORATION_CONFIG } from "./types";
import type { ExplorationProgress, UIBridgeExplorationConfig } from "./types";

const RUNNER_ID = "55555555-5555-4555-8555-555555555555";
const RELAY_PREFIX = "https://api.test/api/v1/device-bridge/runner-proxy";

/** The runner's own relay-path refusal (qontinui-runner `http_relay_error`). */
const RELAY_PATH_REFUSAL = {
  error:
    "this path is not carried by the HTTP relay — the relay serves a closed set of routes",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function remoteTarget(): RunnerTarget {
  return {
    kind: "runner",
    runner: { id: RUNNER_ID, port: 9876, name: "Remote box" },
    locality: "not_local",
  };
}

function localTarget(): RunnerTarget {
  return {
    kind: "runner",
    runner: { id: RUNNER_ID, port: 9877, name: "This box" },
    locality: "local",
  };
}

let loopbackFetch: ReturnType<typeof vi.fn>;

/** Every URL anything tried to fetch, relay and raw alike. */
function fetchedUrls(): string[] {
  return [
    ...relayFetch.mock.calls.map((c) => String(c[0])),
    ...loopbackFetch.mock.calls.map((c) => String(c[0])),
  ];
}

beforeEach(() => {
  __resetRunnerLocalityCache();
  relayFetch.mockReset();
  relayFetch.mockImplementation(async () =>
    jsonResponse(RELAY_PATH_REFUSAL, 403)
  );
  loopbackFetch = vi.fn(async () => jsonResponse({ success: true, data: {} }));
  vi.stubGlobal("fetch", loopbackFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("runnerTargetById", () => {
  const runners = [
    {
      id: "by-host",
      name: "Hostname only",
      hostname: "build-box.lan",
      ipAddress: null,
      port: 9876,
    },
    {
      id: "by-ip",
      name: "IP only",
      hostname: null,
      ipAddress: "10.20.30.40",
      port: 9876,
    },
  ] as unknown as Runner[];

  it("resolves a runner identified only by hostname, by its id", () => {
    const target = runnerTargetById(
      runners,
      new Map([["by-host", "not_local" as const]]),
      "by-host"
    );
    expect(target).toEqual({
      kind: "runner",
      runner: { id: "by-host", port: 9876, name: "Hostname only" },
      locality: "not_local",
    });
  });

  it("carries no address — the resolver reaches the runner by id", () => {
    const target = runnerTargetById(runners, new Map(), "by-ip");
    expect(JSON.stringify(target)).not.toContain("10.20.30.40");
    expect(target).toMatchObject({ kind: "runner", locality: undefined });
  });

  it("is null for no selection or an unlisted id", () => {
    expect(runnerTargetById(runners, new Map(), null)).toBeNull();
    expect(runnerTargetById(runners, new Map(), "gone")).toBeNull();
  });
});

describe("sendRunnerCommand", () => {
  it("sends a non-local runner's command through the relay and surfaces the typed needs-local refusal", async () => {
    const result = await sendRunnerCommand(remoteTarget(), "listTabs", {}, 10);

    expect(relayFetch).toHaveBeenCalledTimes(1);
    const [url, init] = relayFetch.mock.calls[0]!;
    expect(url).toBe(`${RELAY_PREFIX}/extension/command`);
    expect(
      (init as { headers: Record<string, string> }).headers[
        "X-Qontinui-Device-Id"
      ]
    ).toBe(RUNNER_ID);
    expect(loopbackFetch).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.code).toBe(RUNNER_NEEDS_LOCAL);
    expect(result.error).toMatch(/needs the runner on this machine/);
  });

  it("sends a proven-local runner's command over its own loopback port", async () => {
    const result = await sendRunnerCommand(localTarget(), "listTabs", {}, 10);

    expect(relayFetch).not.toHaveBeenCalled();
    expect(loopbackFetch).toHaveBeenCalledTimes(1);
    expect(loopbackFetch.mock.calls[0]![0]).toBe(
      "http://127.0.0.1:9877/extension/command"
    );
    expect(result.success).toBe(true);
  });
});

describe("useExplorationStrategy", () => {
  function renderStrategy(config: UIBridgeExplorationConfig) {
    let progress: ExplorationProgress | null = null;
    const setProgress = vi.fn((update: unknown) => {
      progress =
        typeof update === "function"
          ? (update as (p: ExplorationProgress | null) => ExplorationProgress)(
              progress
            )
          : (update as ExplorationProgress);
    });
    const hook = renderHook(() =>
      useExplorationStrategy({
        config,
        abortRef: { current: false },
        visitedStatesRef: { current: new Set() },
        setProgress: setProgress as never,
        setResults: vi.fn(),
        setPlaywrightJob: vi.fn(),
        setPlaywrightResults: vi.fn(),
        setUIBridgeJob: vi.fn(),
        setUIBridgeResults: vi.fn(),
        createExplorationSession: vi.fn(),
        appendRendersToSession: vi.fn(),
        updateSessionStatus: vi.fn(),
      })
    );
    return { hook, progress: () => progress };
  }

  it("starts a non-local runner's exploration through the relay and records RUNNER_NEEDS_LOCAL", async () => {
    const { hook, progress } = renderStrategy({
      ...DEFAULT_EXPLORATION_CONFIG,
      targetType: "web",
      targetUrl: "https://app.example",
    });

    await expect(
      hook.result.current.startUIBridgeExploration(remoteTarget())
    ).rejects.toMatchObject({ code: RUNNER_NEEDS_LOCAL });

    expect(relayFetch.mock.calls[0]![0]).toBe(
      `${RELAY_PREFIX}/ui-bridge/explore`
    );
    expect(loopbackFetch).not.toHaveBeenCalled();
    expect(progress()).toMatchObject({
      status: "failed",
      errorCode: RUNNER_NEEDS_LOCAL,
    });
    expect(progress()!.error).toMatch(/needs the runner on this machine/);
  });

  it("refuses extension exploration for a runner not proven local without sending anything", async () => {
    const { hook, progress } = renderStrategy({
      ...DEFAULT_EXPLORATION_CONFIG,
      targetType: "extension",
    });

    await expect(
      hook.result.current.startUIBridgeExploration(remoteTarget())
    ).rejects.toMatchObject({ code: RUNNER_NEEDS_LOCAL });
    expect(fetchedUrls()).toEqual([]);
    expect(progress()).toMatchObject({ errorCode: RUNNER_NEEDS_LOCAL });
  });
});

describe("useUIBridgeRecording (extension recording)", () => {
  it("stops the snapshot poll for good on the relay's refusal and records it as typed state", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useUIBridgeRecording());

    act(() => {
      result.current.startPolling(remoteTarget(), 2000);
    });
    // Over the relay the poll runs at the relay cadence, not 2 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(relayFetch).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(relayFetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    await waitFor(() =>
      expect(result.current.session.errorCode).toBe(RUNNER_NEEDS_LOCAL)
    );
    expect(result.current.session.error).toMatch(
      /needs the runner on this machine/
    );

    // Stopped for good: no further ticks.
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(relayFetch).toHaveBeenCalledTimes(1);
    expect(loopbackFetch).not.toHaveBeenCalled();
  });
});
