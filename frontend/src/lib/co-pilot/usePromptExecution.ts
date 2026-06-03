"use client";

/**
 * usePromptExecution.ts
 *
 * The web co-pilot's orchestration hook — the browser-side analog of the
 * runner's `usePromptExecution` (qontinui-runner/src/components/prompt-home).
 * Where the runner executes in-process against its own UI Bridge, the web hook
 * dispatches each step over the relay to the user's own browser tab.
 *
 * Flow of `run(prompt, {explain})`:
 *   1. Resolve the device id from the active paired runner. None → set the
 *      `no-runner-connected` error and stop (the page renders connect-runner).
 *   2. `requestPlan(...)` → the runner's local planner (Phase 1).
 *   3. Resolve this tab's relay tab id; iterate the steps, dispatching each via
 *      `dispatchStep(...)` (Phase 3). Stop on first failure with a
 *      "Step N failed: <reason>" message.
 *
 * The hook does NOT gate on consent/preference (Phase 4 owns those via existing
 * hooks). It exposes a typed error union so the page can render the distinct
 * affordances (re-auth, connect runner, retry, etc.).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveRunner } from "@/contexts/active-runner-context";
import {
  requestPlan,
  PlanError,
  type PlanStep,
  type PlanIntentResult,
} from "./planClient";
import { dispatchStep, getCurrentTabId } from "./relayExecutor";

/** Lifecycle phase of a single `run`. */
export type ExecutionPhase =
  | "idle"
  | "planning"
  | "executing"
  | "done"
  | "error";

/** Per-step execution status, surfaced for the timeline UI. */
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

/**
 * Discriminated error kind. The page maps each onto a distinct affordance:
 *   - auth-required        → "Sign in again" link
 *   - not-consented        → re-open the co-pilot consent modal (Phase 4)
 *   - rate-limited         → "wait and retry"
 *   - no-runner-connected  → "Connect a runner" CTA
 *   - plan-failed          → retry the prompt
 *   - step-failed          → retry / edit prompt; the message names the step
 */
export type ExecutionErrorKind =
  | "auth-required"
  | "not-consented"
  | "rate-limited"
  | "no-runner-connected"
  | "plan-failed"
  | "step-failed";

export interface ExecutionError {
  kind: ExecutionErrorKind;
  message: string;
}

export interface PromptExecutionState {
  phase: ExecutionPhase;
  /** The plan once received (summary + steps). Null before planning completes. */
  plan: PlanIntentResult | null;
  /** Per-step status, index-aligned with `plan.steps`. */
  stepStatuses: StepStatus[];
  /** Index of the step currently executing, or -1 when not executing. */
  currentStepIndex: number;
  /** Convenience mirror of `plan?.summary`. */
  summary: string | null;
  /** Structured error, or null. */
  error: ExecutionError | null;
}

export interface UsePromptExecutionReturn {
  state: PromptExecutionState;
  run: (prompt: string, options?: { explain?: boolean }) => Promise<void>;
  reset: () => void;
}

const INITIAL_STATE: PromptExecutionState = {
  phase: "idle",
  plan: null,
  stepStatuses: [],
  currentStepIndex: -1,
  summary: null,
  error: null,
};

/** Map a thrown {@link PlanError} reason onto the hook's error union. */
function errorFromPlanFailure(err: PlanError): ExecutionError {
  switch (err.reason) {
    case "no-device-id":
      return { kind: "no-runner-connected", message: err.message };
    case "auth-required":
      return { kind: "auth-required", message: err.message };
    case "runner-not-connected":
    case "device-not-owned":
    case "runner-unreachable":
      return { kind: "no-runner-connected", message: err.message };
    case "prompt-rejected":
    case "malformed-plan":
    case "planning-failed":
    default:
      return { kind: "plan-failed", message: err.message };
  }
}

export function usePromptExecution(): UsePromptExecutionReturn {
  const { activeRunner } = useActiveRunner();
  const [state, setState] = useState<PromptExecutionState>(INITIAL_STATE);

  // Guards: prevent overlapping runs and allow `reset` to abort an in-flight one.
  const runningRef = useRef(false);
  const abortRef = useRef(false);

  const reset = useCallback(() => {
    abortRef.current = true;
    setState(INITIAL_STATE);
  }, []);

  // Bug 2 (web-side auto-recover): the `no-runner-connected` error is a
  // LATCH — once a prompt is attempted with no runner, the error card sticks
  // until the user manually retries. The runner→prod connection flaps within
  // ~1 device-JWT TTL of pairing; the runner-side root cause (the refresher /
  // status-signal / banner all gating on the legacy `runner_token` proxy) is
  // fixed in qontinui-runner (plan §"Phase 1 Rust root-cause fix", shipped),
  // so the device re-registers and `activeRunner` re-resolves on its own via
  // the realtime-connections WS/poll. This effect closes the WEB-side gap:
  // when a runner becomes available again, clear the stale
  // `no-runner-connected` latch so the indicator reflects reconnection
  // automatically instead of staying stuck on "No runner connected". We only
  // clear THAT specific idle-error latch — never an in-flight run, and never
  // a different error (plan-failed / rate-limited / not-consented), which the
  // user must see and act on.
  useEffect(() => {
    if (
      activeRunner &&
      !runningRef.current &&
      state.phase === "error" &&
      state.error?.kind === "no-runner-connected"
    ) {
      setState(INITIAL_STATE);
    }
  }, [activeRunner, state.phase, state.error]);

  const run = useCallback(
    async (prompt: string, options?: { explain?: boolean }) => {
      if (runningRef.current) return;
      runningRef.current = true;
      abortRef.current = false;

      const explain = options?.explain ?? false;
      const deviceId = activeRunner?.id ?? null;

      // 1. No runner → stop before contacting the backend.
      if (!deviceId) {
        setState({
          ...INITIAL_STATE,
          phase: "error",
          error: {
            kind: "no-runner-connected",
            message:
              "No paired runner is connected. Connect a runner to run prompts.",
          },
        });
        runningRef.current = false;
        return;
      }

      setState({ ...INITIAL_STATE, phase: "planning" });

      // 2. Plan.
      let plan: PlanIntentResult;
      try {
        plan = await requestPlan({ prompt, deviceId, explain });
      } catch (err) {
        if (abortRef.current) {
          runningRef.current = false;
          return;
        }
        const execError =
          err instanceof PlanError
            ? errorFromPlanFailure(err)
            : {
                kind: "plan-failed" as const,
                message:
                  err instanceof Error ? err.message : "Planning failed.",
              };
        setState({ ...INITIAL_STATE, phase: "error", error: execError });
        runningRef.current = false;
        return;
      }

      if (abortRef.current) {
        runningRef.current = false;
        return;
      }

      const steps: PlanStep[] = plan.steps;
      const statuses: StepStatus[] = steps.map(() => "pending");

      // Empty plan (e.g. a clarification-only summary) is a successful no-op.
      if (steps.length === 0) {
        setState({
          phase: "done",
          plan,
          stepStatuses: statuses,
          currentStepIndex: -1,
          summary: plan.summary,
          error: null,
        });
        runningRef.current = false;
        return;
      }

      // 3. Resolve this tab's relay id. Without it the relay can't route to us.
      const targetTabId = getCurrentTabId();
      if (!targetTabId) {
        setState({
          phase: "error",
          plan,
          stepStatuses: statuses,
          currentStepIndex: -1,
          summary: plan.summary,
          error: {
            kind: "not-consented",
            message:
              "This tab is not registered with the co-pilot relay. Enable and consent to the co-pilot in this tab, then retry.",
          },
        });
        runningRef.current = false;
        return;
      }

      setState({
        phase: "executing",
        plan,
        stepStatuses: statuses,
        currentStepIndex: 0,
        summary: plan.summary,
        error: null,
      });

      // 4. Dispatch each step; stop on the first failure.
      for (let i = 0; i < steps.length; i++) {
        if (abortRef.current) {
          runningRef.current = false;
          return;
        }

        const running = statuses.slice();
        running[i] = "running";
        setState((prev) => ({
          ...prev,
          phase: "executing",
          currentStepIndex: i,
          stepStatuses: running,
        }));

        const result = await dispatchStep(steps[i]!, targetTabId);

        if (abortRef.current) {
          runningRef.current = false;
          return;
        }

        if (!result.ok) {
          const failed = statuses.slice();
          failed[i] = "failed";
          for (let j = i + 1; j < failed.length; j++) failed[j] = "skipped";
          statuses.splice(0, statuses.length, ...failed);

          // A relay 429 is rate limiting; everything else is a step failure.
          const kind: ExecutionErrorKind =
            result.status === 429 ? "rate-limited" : "step-failed";

          setState({
            phase: "error",
            plan,
            stepStatuses: failed,
            currentStepIndex: i,
            summary: plan.summary,
            error: {
              kind,
              message: `Step ${i + 1} failed: ${result.reason}`,
            },
          });
          runningRef.current = false;
          return;
        }

        statuses[i] = "done";
        // Brief settle so a navigation/action's DOM effects land before the
        // next step's relay command observes the page.
        await new Promise((r) => setTimeout(r, 400));
      }

      if (abortRef.current) {
        runningRef.current = false;
        return;
      }

      setState({
        phase: "done",
        plan,
        stepStatuses: statuses.slice(),
        currentStepIndex: -1,
        summary: plan.summary,
        error: null,
      });
      runningRef.current = false;
    },
    [activeRunner],
  );

  return { state, run, reset };
}
