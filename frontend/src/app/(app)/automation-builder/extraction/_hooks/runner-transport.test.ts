/**
 * The extraction hooks call the selected runner by TARGET through the
 * resolver — loopback when proven local, the relay otherwise — and the
 * UI-TARS status tick hands a relay refusal (RUNNER_NEEDS_LOCAL) to its
 * poller so polling stops for good, instead of swallowing it forever.
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const relayFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => relayFetch(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { RUNNER_NEEDS_LOCAL, type RunnerTarget } from "@/lib/runner";
import { useUITarsExtraction } from "./useUITarsExtraction";
import { useVisionExtraction } from "./useVisionExtraction";
import type { ExtractionState } from "./useExtractionState";

const RELAY_PATH_REFUSAL = {
  error:
    "this path is not carried by the HTTP relay — the relay serves a closed set of routes",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const remote: RunnerTarget = {
  kind: "runner",
  runner: { id: "remote-box", port: 9876, name: "Remote" },
  locality: "not_local",
};
const local: RunnerTarget = {
  kind: "runner",
  runner: { id: "this-box", port: 9877, name: "Here" },
  locality: "local",
};

function fakeState(): ExtractionState {
  return {
    selectedRunnerId: "x",
    setUitarsProgress: vi.fn(),
    setIsExtracting: vi.fn(),
    setMainTab: vi.fn(),
    setVisionExtractionProgress: vi.fn(),
  } as unknown as ExtractionState;
}

const uitarsConfig = {
  maxSteps: 5,
  goal: "g",
  provider: "p",
  modelSize: "m",
  quantization: "q",
  timeoutSeconds: 10,
  saveScreenshots: false,
};

let loopbackFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  relayFetch.mockReset();
  relayFetch.mockImplementation(async () => json(RELAY_PATH_REFUSAL, 403));
  loopbackFetch = vi.fn();
  vi.stubGlobal("fetch", loopbackFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useUITarsExtraction", () => {
  function renderUITars(target: RunnerTarget) {
    const state = fakeState();
    const { result } = renderHook(() =>
      useUITarsExtraction({
        state,
        uitarsConfig,
        configMethod: "uitars-web",
        selectedMonitors: [0],
        getRunnerTarget: () => target,
      })
    );
    return { result, state };
  }

  it("rethrows the relay's refusal from the status tick so the poller stops", async () => {
    const { result } = renderUITars(remote);
    await expect(result.current.pollExtractionStatus()).rejects.toMatchObject({
      code: RUNNER_NEEDS_LOCAL,
    });
    expect(relayFetch.mock.calls[0]![0]).toBe(
      "https://api.test/api/v1/device-bridge/runner-proxy/uitars-extraction/status"
    );
    expect(loopbackFetch).not.toHaveBeenCalled();
  });

  it("returns 'stop' once the extraction is over", async () => {
    loopbackFetch.mockImplementation(async () =>
      json({ success: true, data: { status: "completed" } })
    );
    const { result, state } = renderUITars(local);
    await expect(result.current.pollExtractionStatus()).resolves.toBe("stop");
    expect(loopbackFetch.mock.calls[0]![0]).toBe(
      "http://127.0.0.1:9877/uitars-extraction/status"
    );
    expect(state.setIsExtracting).toHaveBeenCalledWith(false);
  });
});

describe("useVisionExtraction", () => {
  it("sends a non-local runner's extraction through the relay and rejects with the typed refusal", async () => {
    const { result } = renderHook(() =>
      useVisionExtraction({
        state: fakeState(),
        visionConfig: {
          source: "monitor",
          edgeDetection: {
            enabled: true,
            cannyLow: 1,
            cannyHigh: 2,
            minContourArea: 1,
            maxContourArea: 2,
          },
          sam3: {
            enabled: false,
            modelType: "m",
            pointsPerSide: 1,
            predIouThreshold: 1,
            stabilityScoreThreshold: 1,
          },
          ocr: { enabled: false, engine: "e", minConfidence: 1 },
          fusion: { iouThreshold: 1, maxCandidates: 1 },
        },
        getRunnerTarget: () => remote,
      })
    );
    await expect(result.current.startVisionExtraction()).rejects.toMatchObject({
      code: RUNNER_NEEDS_LOCAL,
    });
    expect(relayFetch.mock.calls[0]![0]).toBe(
      "https://api.test/api/v1/device-bridge/runner-proxy/extraction/vision"
    );
    expect(loopbackFetch).not.toHaveBeenCalled();
  });
});
