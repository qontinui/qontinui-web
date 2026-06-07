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
import { dispatchStep, resolveTabTarget } from "./relayExecutor";
import { pageIdToUrl } from "./pageMap";

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
 *   - relay-not-connected  → reload the tab to re-register with the relay
 *                            (consent IS granted — this is a tab-registration
 *                            failure, NOT a consent problem; see below)
 *   - rate-limited         → "wait and retry"
 *   - no-runner-connected  → "Connect a runner" CTA
 *   - plan-failed          → retry the prompt
 *   - step-failed          → retry / edit prompt; the message names the step
 *
 * `relay-not-connected` vs `not-consented` — these were CONFLATED and it bit a
 * user: when no relay tab is connected at execution time the hook used to raise
 * `not-consented`, which the page renders as "Consent needed → Grant consent".
 * But the user had ALREADY granted consent (consent is gated upstream before
 * `run()` is even callable), so re-granting did nothing and the co-pilot looked
 * broken. The real failure is that this browser tab never registered with the
 * relay (its `sessionStorage["__uiBridge_tabId"]` is absent / the relay's
 * `/tabs` list has no entry for it — often a registration that lags a
 * just-granted consent, or a tab that went stale past the ~30s heartbeat TTL).
 * The two now map to distinct messages + remedies.
 */
export type ExecutionErrorKind =
  | "auth-required"
  | "not-consented"
  | "relay-not-connected"
  | "rate-limited"
  | "no-runner-connected"
  | "plan-failed"
  | "step-failed";

export interface ExecutionError {
  kind: ExecutionErrorKind;
  message: string;
  /**
   * True when this error was raised by an ACTUAL run attempt that reached the
   * backend and failed there (e.g. `requestPlan` 503 → the runner's WS flapped
   * mid-submit). Distinguishes a FRESH run failure from an IDLE "no runner"
   * latch set before any run reached the backend (the `!deviceId`
   * short-circuit). Only the latter is safe for the reconnect effect to
   * auto-clear; a fromRun error must stay visible so the user gets the
   * "runner reconnecting — retry" affordance instead of a silent reset.
   */
  fromRun?: boolean;
  /**
   * Epoch ms when a `fromRun` `no-runner-connected` error was set. The
   * reconnect latch effect keeps such an error visible for
   * {@link FRESH_RUN_ERROR_GRACE_MS} after this stamp even once `activeRunner`
   * re-resolves, so a flap that re-resolves the device immediately does not
   * swallow the just-raised error.
   */
  setAt?: number;
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

/**
 * How long to wait for this tab's relay registration before declaring
 * `relay-not-connected`. The CommandRelayListener registers asynchronously
 * after consent, so a user who clicks Run immediately can race it. ~3s total
 * (6 × 500ms) covers the registration round-trip without making a genuinely
 * disconnected tab hang noticeably.
 */
const TAB_REGISTRATION_WAIT_ATTEMPTS = 6;
const TAB_REGISTRATION_WAIT_MS = 500;

/**
 * How long to wait, total, after a `navigate` step's relay command is ACCEPTED
 * (200) for the tab to actually reach the target route, and how often to re-check
 * the location within that window.
 *
 * A relay 200 only means "command delivered/accepted", NOT "the page moved": the
 * relay navigate is FIRE-AND-FORGET (the 200 is a publish-ack, not an
 * execution-ack). When delivery silently fails (stale tab, dropped soft-nav) the
 * co-pilot would show "All steps completed" while the tab never moved (false
 * success), so we confirm the page actually landed.
 *
 * Why a POLL, not a single sleep: in production the relay command is delivered
 * CROSS-LAMBDA via the Redis bus, and that round-trip routinely takes LONGER than
 * a single ~600ms check. A one-shot 600ms wait fired BEFORE the page had moved
 * and reported a FALSE failure ("navigation didn't take effect") even though
 * delivery worked. Same-lambda delivery (the in-process injection harness) is
 * <600ms, which masked the bug. We instead poll the location every
 * {@link NAVIGATE_LANDING_POLL_MS} for up to {@link NAVIGATE_LANDING_TIMEOUT_MS}
 * and succeed the instant it moves — only declaring failure if it NEVER moves
 * within the full window.
 *
 * SELF-NAV NUANCE: the co-pilot drives its OWN tab. A SUCCESSFUL navigate
 * soft-routes this very page away from /co-pilot, which unmounts the co-pilot
 * surface and tears down this running hook — so on success the poll naturally
 * stops (and the caller's abort/mounted guards prevent acting on an unmounted
 * component). The poll therefore typically resolves true mid-window on success,
 * or runs the full window and resolves false only when the nav did NOT take
 * effect — exactly the false-success we want to catch.
 */
const NAVIGATE_LANDING_TIMEOUT_MS = 5000;
const NAVIGATE_LANDING_POLL_MS = 300;

/**
 * How long a FRESH `no-runner-connected` error (one raised by an actual run's
 * plan failure — a runner-WS flap at submit) stays visible after being set,
 * even once `activeRunner` re-resolves. The device context typically re-shows
 * the flapped runner within a tick (the realtime-connections WS/poll never lost
 * it), which would otherwise let the reconnect latch effect auto-clear the
 * error the instant it was raised — a silent no-op the user never sees. This
 * grace keeps the "runner reconnecting — retry" affordance on screen long
 * enough to act on. After the window, a still-stale latch may auto-clear as
 * before.
 */
const FRESH_RUN_ERROR_GRACE_MS = 8000;

/**
 * Normalize a pathname for comparison: drop any query/hash and a single
 * trailing slash (but keep root "/"). `pageIdToUrl` returns app-relative paths
 * like "/build/workflows"; `window.location.pathname` is already path-only, but
 * we normalize both sides defensively.
 */
function normalizePath(value: string): string {
  let p = value;
  const q = p.search(/[?#]/);
  if (q >= 0) p = p.slice(0, q);
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/**
 * After a `navigate` step's relay command is accepted, confirm the tab actually
 * landed on `targetUrl`. POLLS `window.location.pathname` every
 * {@link NAVIGATE_LANDING_POLL_MS} for up to {@link NAVIGATE_LANDING_TIMEOUT_MS}
 * and resolves:
 *   - true the instant the page reaches the target route, OR at least leaves the
 *     route it started on (a soft-nav that moved us SOMEWHERE counts as taking
 *     effect) — so cross-lambda delivery that lands at, say, 1.2s succeeds rather
 *     than tripping a premature one-shot check;
 *   - true if we cannot read the location (e.g. SSR — fail-open so we never block
 *     a real success);
 *   - true if `isAborted()` reports the run was reset/unmounted mid-poll (a
 *     successful self-nav unmounts this hook; we must not act on it as a failure);
 *   - false ONLY when the page NEVER moves within the full window — the genuine
 *     non-delivery case we want to surface honestly.
 *
 * `isAborted` lets the poll stop early and bail out without reporting failure
 * when the surrounding run has been aborted (reset) or the component unmounted.
 */
async function confirmNavigationLanded(
  targetUrl: string,
  isAborted: () => boolean,
): Promise<boolean> {
  if (typeof window === "undefined" || !window.location) return true;
  const target = normalizePath(targetUrl);
  const before = normalizePath(window.location.pathname);
  // Already there before we even dispatched (the planner navigated to the page
  // we're on): treat as landed — there is nothing to move.
  if (before === target) return true;

  const deadline = Date.now() + NAVIGATE_LANDING_TIMEOUT_MS;
  // Poll until the page moves, the window elapses, or the run aborts. Check the
  // location immediately on each tick so a fast (same-lambda) nav still resolves
  // quickly, while a slow (cross-lambda Redis-bus) nav gets the full window.
  for (;;) {
    if (isAborted()) return true; // self-nav teardown / reset — not a failure.
    const now = normalizePath(window.location.pathname);
    if (now === target || now !== before) return true;
    if (Date.now() >= deadline) return false; // never moved within the window.
    await new Promise((r) => setTimeout(r, NAVIGATE_LANDING_POLL_MS));
  }
}

/** Map a thrown {@link PlanError} reason onto the hook's error union. */
function errorFromPlanFailure(err: PlanError): ExecutionError {
  switch (err.reason) {
    case "no-device-id":
      // No device id only — the runner genuinely isn't selected/paired.
      return { kind: "no-runner-connected", message: err.message };
    case "auth-required":
      return { kind: "auth-required", message: err.message };
    case "runner-not-connected":
      // 503 — the runner isn't WS-connected. This is the only plan-side reason
      // that is truly "connect a runner". It is a FRESH run failure (the user
      // clicked Run and the runner's WS flapped mid-submit), so stamp it
      // `fromRun` with a `setAt`: the reconnect latch must NOT swallow it the
      // instant `activeRunner` re-resolves (which it does almost immediately —
      // the device context never lost the runner). The user must see the
      // "runner reconnecting — retry" affordance, not a silent reset.
      return {
        kind: "no-runner-connected",
        message: err.message,
        fromRun: true,
        setAt: Date.now(),
      };
    case "device-not-owned":
    case "runner-unreachable":
      // 502/504/timeout/abort — the runner is paired but the relay transport
      // failed or planning ran past the deadline. This is NOT "no runner": map
      // to `plan-failed` (retry the prompt) so the timeout message is shown and
      // is NOT silently cleared by the no-runner-connected reconnect latch.
      return { kind: "plan-failed", message: err.message };
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
  // Tracks whether the hook is still mounted. A SUCCESSFUL self-navigation
  // soft-routes the co-pilot page away and unmounts this hook mid-run; the
  // navigate landing poll uses this to stop and bail WITHOUT reporting a false
  // failure (an unmount during the poll means the nav took effect).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
  //
  // CRITICAL nuance (the silent-no-op bug): the auto-clear used to also swallow
  // a FRESH no-runner error raised by the just-completed run (a 503 because the
  // runner's WS flapped at submit). `activeRunner` re-resolves almost instantly
  // after such a flap (the device context never lost the runner), so the effect
  // fired on the very next render and reset the state to idle — the user clicked
  // Run, the plan 503'd, and the button just reset with NO error card: a silent
  // no-op. We now distinguish:
  //   - an IDLE/stale latch (`!fromRun` — set by the `!deviceId` short-circuit
  //     before any run reached the backend) → safe to auto-clear on reconnect;
  //   - a FRESH run failure (`fromRun`, 503 from `requestPlan`) → must stay
  //     visible for {@link FRESH_RUN_ERROR_GRACE_MS} so the user sees the
  //     "runner reconnecting — retry" affordance. After the grace window a still
  //     -stale latch auto-clears as before (a re-render is scheduled below).
  useEffect(() => {
    if (
      !activeRunner ||
      runningRef.current ||
      state.phase !== "error" ||
      state.error?.kind !== "no-runner-connected"
    ) {
      return;
    }

    // A fresh run failure within its grace window must stay visible. Schedule a
    // re-check at the end of the window so a latch that is STILL stale then
    // (the user never retried, the error is now an idle indicator) clears.
    if (state.error.fromRun && state.error.setAt) {
      const elapsed = Date.now() - state.error.setAt;
      if (elapsed < FRESH_RUN_ERROR_GRACE_MS) {
        const remaining = FRESH_RUN_ERROR_GRACE_MS - elapsed;
        const timer = setTimeout(() => {
          // Re-arm the effect; if still an unretried no-runner error and a
          // runner is present, the next pass (now past the window) clears it.
          setState((prev) =>
            prev.phase === "error" &&
            prev.error?.kind === "no-runner-connected" &&
            prev.error.fromRun
              ? { ...prev, error: { ...prev.error, setAt: 0 } }
              : prev,
          );
        }, remaining);
        return () => clearTimeout(timer);
      }
    }

    setState(INITIAL_STATE);
    return undefined;
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

      // 3. Resolve the tab to drive against the relay's LIVE tab list. A bare
      //    cached sessionStorage id goes stale once the relay drops the tab on
      //    its ~30s heartbeat TTL (or it re-registers under a new id), which is
      //    what made every step fail with "tabId is not in connectedTabs".
      //    `resolveTabTarget` confirms the cached id is live, else falls back to
      //    the sole connected tab or omits the id (relay routes to its primary).
      // The relay tab registration can LAG a just-granted consent (the user
      // clicks Run the moment the badge turns green, before the
      // CommandRelayListener has POSTed its registration). Rather than fail
      // instantly, briefly re-resolve against the live `/tabs` list a few times
      // before giving up — this turns a registration race into a short wait.
      let tabTarget = await resolveTabTarget();
      for (
        let attempt = 0;
        attempt < TAB_REGISTRATION_WAIT_ATTEMPTS &&
        !tabTarget.hasConnectedTab &&
        !abortRef.current;
        attempt++
      ) {
        await new Promise((r) => setTimeout(r, TAB_REGISTRATION_WAIT_MS));
        tabTarget = await resolveTabTarget();
      }
      if (abortRef.current) {
        runningRef.current = false;
        return;
      }
      const { targetTabId, hasConnectedTab } = tabTarget;
      if (!hasConnectedTab) {
        // NOT a consent problem — consent is already granted (it's gated
        // upstream before run() is callable). This browser tab simply never
        // registered with the relay. Surface that distinctly so the remedy is
        // "reload the page" (re-mounts the listener → re-registers the tab),
        // not the useless "grant consent again".
        setState({
          phase: "error",
          plan,
          stepStatuses: statuses,
          currentStepIndex: -1,
          summary: plan.summary,
          error: {
            kind: "relay-not-connected",
            message:
              "Your consent is granted, but this browser tab isn't connected to the co-pilot relay. Reload the page, then try again.",
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

        const step = steps[i]!;
        const result = await dispatchStep(step, targetTabId);

        if (abortRef.current) {
          runningRef.current = false;
          return;
        }

        // Honest-success check for navigation: a relay 200 only means the
        // navigate command was ACCEPTED, not that the page moved. Confirm the
        // tab actually left its current route before marking the step done.
        // (A SUCCESSFUL self-navigation unmounts this hook, so this check only
        // resolves false when the nav did NOT take effect — i.e. we're still
        // mounted on the same route.) If it didn't move, mark the step FAILED
        // with an honest message instead of a false "done".
        if (result.ok && step.type === "navigate" && step.target) {
          const targetUrl = pageIdToUrl(step.target);
          if (targetUrl !== undefined) {
            // Poll for landing; bail out (without reporting failure) if the run
            // is reset or the component unmounts mid-poll — a SUCCESSFUL self-nav
            // unmounts the co-pilot page, so an unmount here is success, not a
            // "didn't take effect" failure.
            const landed = await confirmNavigationLanded(
              targetUrl,
              () => abortRef.current || !mountedRef.current,
            );
            if (abortRef.current || !mountedRef.current) {
              runningRef.current = false;
              return;
            }
            if (!landed) {
              const failed = statuses.slice();
              failed[i] = "failed";
              for (let j = i + 1; j < failed.length; j++) failed[j] = "skipped";
              statuses.splice(0, statuses.length, ...failed);
              setState({
                phase: "error",
                plan,
                stepStatuses: failed,
                currentStepIndex: i,
                summary: plan.summary,
                error: {
                  kind: "step-failed",
                  message: `Step ${i + 1} failed: navigation didn't take effect — the relay accepted it but the tab didn't move to ${targetUrl}.`,
                },
              });
              runningRef.current = false;
              return;
            }
          }
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
