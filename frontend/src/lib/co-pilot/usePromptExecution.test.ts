/**
 * usePromptExecution.test.ts
 *
 * Regression tests for the co-pilot orchestration hook's failure handling.
 *
 * The live prod E2E showed the UI hung on "Planning…" forever when the planner
 * call returned 502/504: `run()` never left `phase:"planning"`, so no error
 * affordance rendered and the submit button stayed disabled. These tests pin
 * the contract that ANY `requestPlan` rejection — timeout, 502/504, 503, or a
 * malformed plan — deterministically drives the hook to `phase:"error"` with a
 * non-null, correctly-kinded `ExecutionError` (never stuck on "planning").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { PlanError, type PlanErrorReason } from "./planClient";

// ---- Mock the active runner context so a runner is always "connected"
// (so `run()` proceeds to the plan call rather than short-circuiting on
// no-runner-connected). ----
vi.mock("@/contexts/active-runner-context", () => ({
  useActiveRunner: () => ({
    activeRunner: { id: "runner-1" },
    runners: [],
    selectRunner: vi.fn(),
    isMultiRunner: false,
  }),
}));

// ---- Mock the plan + relay clients. `requestPlan` is the unit under test's
// dependency; `dispatchStep`/`getCurrentTabId` are not exercised on the error
// paths but must exist so the module imports cleanly. ----
const requestPlanMock = vi.fn();
vi.mock("./planClient", async () => {
  // Re-export the real PlanError class (the hook's `instanceof` check + the
  // error mapping depend on the real class identity), but stub `requestPlan`.
  const actual =
    await vi.importActual<typeof import("./planClient")>("./planClient");
  return {
    ...actual,
    requestPlan: (...args: unknown[]) => requestPlanMock(...args),
  };
});

const dispatchStepMock = vi.fn();
const resolveTabTargetMock = vi.fn();
vi.mock("./relayExecutor", () => ({
  dispatchStep: (...args: unknown[]) => dispatchStepMock(...args),
  resolveTabTarget: (...args: unknown[]) => resolveTabTargetMock(...args),
}));

import { usePromptExecution } from "./usePromptExecution";

beforeEach(() => {
  requestPlanMock.mockReset();
  dispatchStepMock.mockReset();
  resolveTabTargetMock.mockReset();
  // Default: a tab is connected so tests that reach execution proceed.
  resolveTabTargetMock.mockResolvedValue({
    targetTabId: "tab-1",
    hasConnectedTab: true,
  });
  dispatchStepMock.mockResolvedValue({ ok: true, detail: "done" });
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("usePromptExecution — plan failure never hangs on 'planning'", () => {
  it("transitions to phase:'error' (plan-failed) on a 504 / timeout, never stuck planning", async () => {
    // The exact symptom from the E2E: the plan call times out (504 / abort).
    // planClient maps these to a `runner-unreachable` PlanError.
    requestPlanMock.mockRejectedValue(
      new PlanError(
        "runner-unreachable",
        "Planning timed out — the runner took too long. Try again or a simpler prompt.",
        504,
      ),
    );

    const { result } = renderHook(() => usePromptExecution());

    await act(async () => {
      await result.current.run("do a thing");
    });

    await waitFor(() => {
      expect(result.current.state.phase).toBe("error");
    });

    // The defining assertion: it is NOT stuck on planning, and an actionable
    // error is present (not null).
    expect(result.current.state.phase).not.toBe("planning");
    expect(result.current.state.error).not.toBeNull();
    expect(result.current.state.error?.kind).toBe("plan-failed");
    expect(result.current.state.error?.message).toMatch(/timed out/i);
  });

  it("does not hang on 'planning' for a 503 / runner-not-connected", async () => {
    // 503 maps to kind `no-runner-connected`. With a live `activeRunner` the
    // hook's reconnect latch effect immediately clears that specific error back
    // to idle (intended: the runner is available again). The contract we pin
    // here is the regression one — it must NOT remain stuck on "planning".
    requestPlanMock.mockRejectedValue(
      new PlanError(
        "runner-not-connected",
        "The runner is not connected.",
        503,
      ),
    );

    const { result } = renderHook(() => usePromptExecution());

    await act(async () => {
      await result.current.run("do a thing");
    });

    await waitFor(() => {
      expect(result.current.state.phase).not.toBe("planning");
    });
    // Either the error surfaced, or the no-runner latch already cleared it to
    // idle — but never a silent hang on "planning".
    expect(["error", "idle"]).toContain(result.current.state.phase);
  });

  it.each<[PlanErrorReason, "plan-failed"]>([
    ["malformed-plan", "plan-failed"],
    ["planning-failed", "plan-failed"],
    ["runner-unreachable", "plan-failed"], // 502/504
  ])(
    "maps reason '%s' to error kind '%s' (always leaves planning)",
    async (reason, expectedKind) => {
      requestPlanMock.mockRejectedValue(
        new PlanError(reason, `failed: ${reason}`, 502),
      );

      const { result } = renderHook(() => usePromptExecution());

      await act(async () => {
        await result.current.run("do a thing");
      });

      await waitFor(() => {
        expect(result.current.state.phase).toBe("error");
      });
      expect(result.current.state.phase).not.toBe("planning");
      expect(result.current.state.error).not.toBeNull();
      expect(result.current.state.error?.kind).toBe(expectedKind);
    },
  );

  it("transitions to error on a non-PlanError (raw network throw), not stuck planning", async () => {
    requestPlanMock.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => usePromptExecution());

    await act(async () => {
      await result.current.run("do a thing");
    });

    await waitFor(() => {
      expect(result.current.state.phase).toBe("error");
    });
    expect(result.current.state.phase).not.toBe("planning");
    expect(result.current.state.error).not.toBeNull();
    expect(result.current.state.error?.kind).toBe("plan-failed");
  });
});

describe("usePromptExecution — relay tab not connected is NOT a consent error", () => {
  const planWithStep = {
    summary: "Navigate to the workflows page",
    steps: [{ type: "navigate", target: "page-gui-automation" }],
  };

  it(
    "raises 'relay-not-connected' (not 'not-consented') when no tab ever connects, and does not dispatch",
    async () => {
      // Regression for the live bug: consent IS granted (gated upstream), but
      // the tab never registered with the relay. The error must NOT claim
      // "consent needed" — that sent the user re-granting consent uselessly.
      requestPlanMock.mockResolvedValue(planWithStep);
      resolveTabTargetMock.mockResolvedValue({
        targetTabId: null,
        hasConnectedTab: false,
      });

      const { result } = renderHook(() => usePromptExecution());
      await act(async () => {
        await result.current.run("go to the workflows page");
      });

      await waitFor(() => {
        expect(result.current.state.phase).toBe("error");
      });
      expect(result.current.state.error?.kind).toBe("relay-not-connected");
      expect(result.current.state.error?.kind).not.toBe("not-consented");
      expect(result.current.state.error?.message).toMatch(/consent is granted/i);
      expect(dispatchStepMock).not.toHaveBeenCalled();
    },
    15000,
  );

  it("proceeds once the tab registers after a brief lag (does not error)", async () => {
    // The registration race: first resolve reports no tab, a later one finds
    // it. The wait-retry must pick it up and execute rather than failing.
    requestPlanMock.mockResolvedValue(planWithStep);
    resolveTabTargetMock
      .mockResolvedValueOnce({ targetTabId: null, hasConnectedTab: false })
      .mockResolvedValue({ targetTabId: "tab-late", hasConnectedTab: true });

    const { result } = renderHook(() => usePromptExecution());
    await act(async () => {
      await result.current.run("go to the workflows page");
    });

    await waitFor(() => {
      expect(["done", "error"]).toContain(result.current.state.phase);
    });
    expect(result.current.state.error?.kind).not.toBe("relay-not-connected");
    expect(dispatchStepMock).toHaveBeenCalledWith(
      planWithStep.steps[0],
      "tab-late",
    );
  });
});

describe("usePromptExecution — navigate landing check (honest success)", () => {
  // `unified-workflow-builder` -> /build/workflows (a real co-pilot page id, so
  // pageIdToUrl resolves and the landing check engages).
  const navPlan = {
    summary: "Navigate to the workflows page",
    steps: [
      {
        type: "navigate" as const,
        target: "unified-workflow-builder",
        explanation: "go to the workflows page",
      },
    ],
  };

  beforeEach(() => {
    // Start every test on the co-pilot's own route.
    window.history.replaceState({}, "", "/co-pilot");
  });

  it("marks the navigate step FAILED when the tab did NOT move (relay accepted but page stayed put)", async () => {
    requestPlanMock.mockResolvedValue(navPlan);
    // Relay accepts the navigate (200/ok) but the page never moves — we stay on
    // /co-pilot. This is the silent-delivery-failure false-success case.
    dispatchStepMock.mockResolvedValue({ ok: true, detail: "navigated" });

    const { result } = renderHook(() => usePromptExecution());
    await act(async () => {
      await result.current.run("go to the workflows page");
    });

    await waitFor(() => {
      expect(result.current.state.phase).toBe("error");
    });
    // NOT a false "done" — an honest step failure.
    expect(result.current.state.phase).not.toBe("done");
    expect(result.current.state.error?.kind).toBe("step-failed");
    expect(result.current.state.error?.message).toMatch(
      /navigation didn't take effect/i,
    );
    expect(result.current.state.error?.message).toContain("/build/workflows");
    expect(result.current.state.stepStatuses[0]).toBe("failed");
  });

  it("marks the navigate step DONE when the tab actually reached the target route", async () => {
    requestPlanMock.mockResolvedValue(navPlan);
    // Simulate a successful soft-nav: the relay accepts AND the tab moves to the
    // target route (in the real app a successful self-nav unmounts the hook; we
    // can't unmount mid-act, so we model "the page moved" by changing the path).
    dispatchStepMock.mockImplementation(async () => {
      window.history.replaceState({}, "", "/build/workflows");
      return { ok: true, detail: "navigated" };
    });

    const { result } = renderHook(() => usePromptExecution());
    await act(async () => {
      await result.current.run("go to the workflows page");
    });

    await waitFor(() => {
      expect(result.current.state.phase).toBe("done");
    });
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.stepStatuses[0]).toBe("done");
  });
});
