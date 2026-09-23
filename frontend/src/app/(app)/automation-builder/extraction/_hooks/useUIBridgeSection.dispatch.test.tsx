/**
 * The extraction page's runner for NEW work (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 3).
 *
 * - Extension mode starts exploration / recording on the READ target (the
 *   browser extension on this machine, through the active runner when it is
 *   proven local). That is new work, so it is gated on the new-work rule: no
 *   start target and a refusal while coord names no runner.
 * - The page's own runner selection is AUTO-FILLED from the dispatch runner;
 *   an auto-filled id follows the dispatch target (moved or cleared), and only
 *   a runner the user picked here is sticky.
 */

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerTarget } from "@/lib/runner/target";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LOCAL_READ: RunnerTarget = {
  kind: "runner",
  runner: { id: A, port: 9876 },
  locality: "local",
};

const state = vi.hoisted(() => ({
  targetType: "extension" as string,
  refusal: null as string | null,
  dispatchId: null as string | null,
}));

vi.mock("@/hooks/ui-bridge", () => ({
  useUIBridgeExploration: () => ({
    config: { targetType: state.targetType },
    fetchBrowserTabs: vi.fn(),
    selectBrowserTab: vi.fn(),
  }),
}));
vi.mock("@/hooks/useUIBridgeRecording", () => ({
  useUIBridgeRecording: () => ({}),
}));
vi.mock("@/hooks/useRealtimeConnections", () => ({
  useRealtimeConnections: () => ({ runners: [], isLoading: false }),
}));
vi.mock("@/lib/runner", async (orig) => ({
  ...(await orig<typeof import("@/lib/runner")>()),
  useRunnerTarget: () => LOCAL_READ,
}));
vi.mock("@/lib/ui-bridge/discovered-specs", () => ({
  isRunnerReachable: () => true,
}));
vi.mock("@/lib/runner/origin", () => ({ isRunnerReachable: () => true }));
vi.mock("@/contexts/active-runner-context", () => ({
  useActiveRunner: () => ({ localityById: new Map() }),
  buildRunnerTarget: vi.fn(),
  useNewWorkRefusal: () => state.refusal,
  useDispatchRunnerTarget: () =>
    state.dispatchId === null
      ? {
          target: { kind: "unavailable", reason: "no_eligible_runner" },
          runnerId: null,
          refusal: { reason: "all_drained", message: state.refusal ?? "x" },
        }
      : {
          target: {
            kind: "runner",
            runner: { id: state.dispatchId },
            locality: "unknown",
          },
          runnerId: state.dispatchId,
          refusal: null,
        },
}));
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: vi.fn(async () => new Response("[]", { status: 200 })),
  },
}));

import { useUIBridgeSection } from "./useUIBridgeSection";

function useHarness() {
  const [selectedRunnerId, setSelectedRunnerId] = useState<string | null>(null);
  const section = useUIBridgeSection({
    state: { selectedRunnerId, setSelectedRunnerId } as never,
    configMethod: "manual",
  });
  return { section, selectedRunnerId };
}

beforeEach(() => {
  state.targetType = "extension";
  state.refusal = null;
  state.dispatchId = null;
});

describe("extension-mode starts are gated on the new-work rule", () => {
  it("refused: no start target, and the refusal is exposed", () => {
    state.refusal =
      "All your runners are drained — taken out of service for new work.";
    const { result } = renderHook(() => useHarness());
    expect(result.current.section.startRefusal).toBe(state.refusal);
    expect(result.current.section.getStartTarget(null)).toBeNull();
    // Reads (stop, status) still reach the extension's runner.
    expect(result.current.section.getRunnerTarget(null)).toBe(LOCAL_READ);
  });

  it("allowed: the start target is the extension's (read) runner", () => {
    state.dispatchId = A;
    const { result } = renderHook(() => useHarness());
    expect(result.current.section.startRefusal).toBeNull();
    expect(result.current.section.getStartTarget(null)).toBe(LOCAL_READ);
  });
});

describe("the auto-filled runner follows the dispatch target", () => {
  beforeEach(() => {
    state.targetType = "web";
  });

  it("moves with coord's pick, and clears when new work is refused", () => {
    state.dispatchId = B;
    const { result, rerender } = renderHook(() => useHarness());
    expect(result.current.selectedRunnerId).toBe(B);

    state.dispatchId = C;
    rerender();
    expect(result.current.selectedRunnerId).toBe(C);

    state.dispatchId = null;
    state.refusal = "drained";
    rerender();
    expect(result.current.selectedRunnerId).toBeNull();
  });

  it("a runner the user picked is sticky", () => {
    state.dispatchId = B;
    const { result, rerender } = renderHook(() => useHarness());
    act(() => result.current.section.onRunnerChange(C));
    expect(result.current.selectedRunnerId).toBe(C);

    state.dispatchId = A;
    rerender();
    expect(result.current.selectedRunnerId).toBe(C);
    state.dispatchId = null;
    rerender();
    expect(result.current.selectedRunnerId).toBe(C);
  });

  it("confirming the auto-filled runner in the selector makes it sticky", () => {
    state.dispatchId = B;
    const { result, rerender } = renderHook(() => useHarness());
    expect(result.current.selectedRunnerId).toBe(B);
    act(() => result.current.section.onRunnerChange(B));

    state.dispatchId = C;
    rerender();
    expect(result.current.selectedRunnerId).toBe(B);
  });
});
