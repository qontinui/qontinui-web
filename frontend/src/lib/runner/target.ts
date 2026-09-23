/**
 * Runner targets and routes — WHICH runner a call is for, and HOW it gets there.
 *
 * Plan 2026-09-20-runner-selector-drives-a-transport-not-a-target, D4: the
 * transport is resolved PER REQUEST from an explicit target, never read from a
 * module-global base URL. A `RunnerTarget` is a value the caller holds (from
 * `useRunnerTarget()` in React code, or passed in as a parameter elsewhere);
 * `resolveRunnerRoute` turns it into a `RunnerRoute` at the moment of the call:
 *
 *   - loopback `http://127.0.0.1:<port>` — ONLY for a runner PROVEN local
 *     (its loopback `/settings/device-info` answered with its own id, see
 *     ./locality). Unknown is never read as local.
 *   - the backend relay (`/api/v1/device-bridge/runner-proxy/<path>` with
 *     `X-Qontinui-Device-Id`) for every other listed runner — including every
 *     runner at all on a production origin, where Chrome's Local Network
 *     Access blocks public→loopback and the locality probe answers `unknown`.
 *
 * ONE deliberate exception to "loopback only when proven local":
 * `default_local` — the runner list LOADED and is genuinely EMPTY (no runner
 * paired at all). Then there is no runner id to prove or to relay to, so calls
 * go to the default port (DEFAULT_RUNNER_PORT, on 127.0.0.1) UNPROVEN — still origin-gated (never
 * from a non-localhost page). It exists so a developer with a local runner
 * that has not paired yet keeps a working UI; it never applies while the list
 * is loading or failed, nor once any runner is listed.
 *
 * This module has no React and no network of its own beyond the locality
 * probe (./locality), so it is shared by the fetch client, the hooks and the
 * event stream.
 */

import {
  DEFAULT_RUNNER_PORT,
  loopbackBaseForPort,
  measureRunnerLocality,
  type RunnerLocality,
} from "./locality";
import { isRunnerReachable } from "./origin";

/** The fields of a runner a target carries. `id` is the coord device id. */
export interface RunnerRef {
  id: string;
  port?: number | null;
  name?: string;
}

/**
 * Why no runner can be addressed right now.
 *
 * - `list_unavailable`   — the runner list failed to load: there is no runner
 *                          to address, and the default port is NOT assumed.
 * - `resolver_unavailable` — the user has chosen no runner and coord's device
 *                          resolver is UNKNOWN (unreachable, not deployed, a
 *                          refused credential), with no last resolved runner
 *                          and none proven on this machine to keep using.
 *                          List order is never used instead (plan Phase 3).
 * - `no_eligible_runner` — coord answered that none of the user's runners is
 *                          eligible (none online, none capable, all drained).
 */
export type RunnerUnavailableReason =
  | "list_unavailable"
  | "resolver_unavailable"
  | "no_eligible_runner";

export type RunnerTarget =
  /**
   * A listed runner. `locality` is the provider's measurement at the time the
   * target was built (undefined = not measured yet); the route is resolved from
   * it, and measured on demand when it is absent.
   */
  | { kind: "runner"; runner: RunnerRef; locality: RunnerLocality | undefined }
  /**
   * The runner list loaded and is genuinely empty: the default loopback port,
   * reachable only from a localhost origin. There is no runner id, so there is
   * nothing to relay to.
   */
  | { kind: "default_local" }
  /**
   * Nothing is known yet (list loading, or auto-select still measuring).
   * `settle` — supplied by the ActiveRunnerProvider that built this target —
   * resolves with the provider's next non-pending target, or the current one
   * after `timeoutMs`. Without it (no provider) a pending target refuses at
   * once.
   */
  | {
      kind: "pending";
      runnerName?: string;
      settle?: (timeoutMs: number) => Promise<RunnerTarget>;
    }
  | {
      kind: "unavailable";
      reason: RunnerUnavailableReason;
      /**
       * Why, in the words of whoever refused — e.g. coord's outcome when new
       * work may not be placed. Replaces the reason's generic message.
       */
      message?: string;
    };

export type RunnerRoute =
  | { kind: "loopback"; base: string; runnerId: string | null }
  | { kind: "relay"; runnerId: string; runnerName?: string };

/**
 * What `routeOfTarget` can say synchronously: a route, or that a route needs
 * a measurement first (`measuring`), or that there is none (`refused`).
 */
export type RunnerRouteState =
  | RunnerRoute
  | { kind: "measuring" }
  | { kind: "refused"; reason: RunnerUnavailableReason | "origin_unreachable" };

/** The target used outside an ActiveRunnerProvider: nothing is known, nothing waits. */
export const NO_RUNNER_TARGET: RunnerTarget = { kind: "pending" };

/** The loopback base of the default runner port (the empty-list case only). */
export const DEFAULT_RUNNER_BASE = loopbackBaseForPort(DEFAULT_RUNNER_PORT);

/**
 * The route a target resolves to right now, from what the target itself
 * carries. Pure and synchronous — used for keys (data and shared polls are
 * keyed by target + route) and for the poll cadence.
 */
export function routeOfTarget(target: RunnerTarget): RunnerRouteState {
  switch (target.kind) {
    case "pending":
      return { kind: "measuring" };
    case "unavailable":
      return { kind: "refused", reason: target.reason };
    case "default_local":
      return isRunnerReachable()
        ? { kind: "loopback", base: DEFAULT_RUNNER_BASE, runnerId: null }
        : { kind: "refused", reason: "origin_unreachable" };
    case "runner":
      return routeForLocality(target.runner, target.locality);
  }
}

function routeForLocality(
  runner: RunnerRef,
  locality: RunnerLocality | undefined
): RunnerRouteState {
  if (locality === undefined) return { kind: "measuring" };
  // The ONLY way to a loopback route: an identity proof on this runner's port.
  if (locality === "local" && runner.port != null && isRunnerReachable()) {
    return {
      kind: "loopback",
      base: loopbackBaseForPort(runner.port),
      runnerId: runner.id,
    };
  }
  // not_local, unknown, or a production origin: the runner is addressed by
  // its device id through the backend, which cannot reach the wrong box.
  return { kind: "relay", runnerId: runner.id, runnerName: runner.name };
}

/**
 * Resolve the route for one request. Waits for a measurement the target does
 * not carry yet: a listed runner's locality probe (shared, cached — see
 * ./locality), or a pending target's provider (up to `waitMs`). An aborted
 * `signal` ends the wait at once with its reason (an AbortError), so a
 * caller's cancellation or deadline covers route resolution too.
 */
export async function resolveRunnerRoute(
  target: RunnerTarget,
  waitMs: number,
  signal?: AbortSignal | null
): Promise<RunnerRouteState> {
  let current = target;
  if (current.kind === "pending" && current.settle) {
    current = await abortable(current.settle(waitMs), signal);
  }
  throwIfAborted(signal);
  const state = routeOfTarget(current);
  if (state.kind !== "measuring" || current.kind !== "runner") return state;
  const locality = await abortable(
    measureRunnerLocality(current.runner),
    signal
  );
  return routeForLocality(current.runner, locality);
}

function abortError(signal: AbortSignal): unknown {
  return (
    signal.reason ??
    new DOMException("The operation was aborted.", "AbortError")
  );
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw abortError(signal);
}

/** `promise`, or a rejection with the signal's reason as soon as it aborts. */
function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal | null
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}

/**
 * A stable string for a target + its route: equal keys mean "the same runner,
 * reached the same way". Query data and shared polls are keyed by it, so an
 * answer fetched from one runner (or over one transport) is never served as
 * another's.
 */
export function targetKey(target: RunnerTarget): string {
  const state = routeOfTarget(target);
  switch (state.kind) {
    case "loopback":
      return `loopback:${state.base}:${state.runnerId ?? "default"}`;
    case "relay":
      return `relay:${state.runnerId}`;
    case "measuring":
      return target.kind === "runner"
        ? `measuring:${target.runner.id}`
        : "measuring";
    case "refused":
      return `refused:${state.reason}`;
  }
}

/**
 * The device id the target addresses, or null when it addresses no runner.
 * A runner coord resolved that the web list has not caught up with is still a
 * real runner here (reached over the relay by this id) — so surfaces that
 * need "which runner" read it from the target, not from the list's
 * `activeRunner`.
 */
export function targetRunnerId(target: RunnerTarget): string | null {
  return target.kind === "runner" ? target.runner.id : null;
}

/** The runner's display name, when the target names one. */
export function targetRunnerName(target: RunnerTarget): string | undefined {
  if (target.kind === "runner") return target.runner.name;
  if (target.kind === "pending") return target.runnerName;
  return undefined;
}

/**
 * The loopback URL of `path` on the target — ONLY when the target's route is
 * loopback (a runner proven local, or the empty-list default); otherwise null.
 *
 * For the transports the relay cannot carry: WebSocket and EventSource
 * streams. A null means "no stream can exist for this target" — the consumer
 * renders UNKNOWN or falls back to polling through `runnerRequest`, never a
 * silent empty stream. Everything request/response goes through
 * `runnerRequest` instead, which relays.
 */
export function runnerLoopbackUrl(
  target: RunnerTarget,
  path: string
): string | null {
  const route = routeOfTarget(target);
  return route.kind === "loopback" ? `${route.base}${path}` : null;
}

/**
 * Where a user can pick a runner. Named by surface because most surfaces that
 * show a refusal carry no picker themselves; the Run-on control is rendered
 * on these surfaces with any number of runners (one included), so a
 * single-runner user is not sent to a control that only appears with many.
 */
export const PICK_HINT =
  "pick a runner with “Run on” (on Co-Pilot, Execute or Capture)";
