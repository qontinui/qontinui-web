"use client";

/**
 * The runner API client: one per-request transport resolver.
 *
 * Every runner call names its TARGET explicitly (`useRunnerTarget()` in React
 * code, a parameter elsewhere) and the transport is resolved at the moment of
 * the call (./target `resolveRunnerRoute`): loopback for a runner proven to
 * be on this machine, the backend relay (./relay) for any other. There is no
 * module-global base URL and no transport-change subscription — plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, D4 / Phase 2.
 *
 *   runnerRequest(target, path, init)  → Response   (raw; the migration door
 *                                                     for hand-rolled fetches)
 *   runnerFetch(target, path, opts)    → T          (JSON, envelope unwrapped,
 *                                                     typed errors)
 *   useRunnerQuery(target, path, opts)              (shared, keyed polls)
 *   useRunnerMutation(target, path, method)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  describeRunnerOriginRefusal,
  readRunnerOriginRefusal,
  type RunnerOriginRefusal,
} from "./origin-refusal";
import { measureRunnerLocality, type RunnerLocality } from "./locality";
import {
  readRelayDiagnostics,
  readRelayPathRefusal,
  relayClientDeadlineMs,
  relayRequest,
  relayWaitMs,
  type RunnerRelayDiagnostics,
} from "./relay";
import {
  resolveRunnerRoute,
  routeOfTarget,
  targetKey,
  targetRunnerName,
  type RunnerRoute,
  type RunnerRouteState,
  type RunnerTarget,
} from "./target";

export type { RunnerTarget, RunnerRoute } from "./target";

// =============================================================================
// Configuration
// =============================================================================

export const DEFAULT_POLL_INTERVAL = 5000;
export const HEALTH_POLL_INTERVAL = 10000;

/**
 * The slowest-allowed poll cadence over the relay: a relayed poll never runs
 * faster than this, whatever the subscriber asked for.
 *
 * Over loopback a poll is a same-machine socket read; over the relay it is an
 * authenticated backend request, a Redis-routed WebSocket hop to the runner
 * and back, and a backend worker held for the round trip — for every tab of
 * every user. 15 s is 3× DEFAULT_POLL_INTERVAL (so a page of 5 s pollers
 * costs the backend a third of what it would at loopback cadence) and still
 * 6× inside the backend's 90 s runner-freshness window, so a relayed status
 * cannot go stale by the backend's own definition between two polls.
 */
export const RELAY_POLL_INTERVAL_MS = 15_000;

/** runnerFetch's default deadline over loopback. */
const LOOPBACK_TIMEOUT_MS = 5000;
/**
 * runnerFetch's default relay budget when the caller named none: the
 * HTTP-over-WS hop adds a backend round trip and a Redis hand-off, so the
 * loopback 5 s would time out healthy relayed reads. Half the backend's own
 * 30 s relay default. (Any budget goes through `relayWaitMs`, which floors it
 * at RELAY_FLOOR_WAIT_MS — see ./relay.)
 */
const RELAY_TIMEOUT_MS = 15_000;

/**
 * How long a request for a PENDING target waits for the ActiveRunnerProvider
 * to resolve one (list load + locality probes). 8 s covers a slow cold list
 * load plus one probe timeout with margin, while still failing a call that
 * nothing will resolve well inside a user's patience.
 */
const MEASURING_WAIT_MS = 8000;

// =============================================================================
// Errors
// =============================================================================

/** The runner list could not be loaded, so no runner can be addressed. */
export const RUNNER_LIST_UNAVAILABLE = "RUNNER_LIST_UNAVAILABLE";
/** Nothing resolved a runner in time (list loading / locality measuring / no provider). */
export const RUNNER_LOCALITY_UNKNOWN = "RUNNER_LOCALITY_UNKNOWN";
/**
 * Several runners are listed, none is proven local and none is chosen: the
 * user must pick one — work is never sent to a machine they did not pick.
 */
export const RUNNER_SELECTION_REQUIRED = "RUNNER_SELECTION_REQUIRED";
/**
 * This page's origin cannot reach loopback, and the target has no runner id to
 * relay to (the empty-list default). Says nothing about which machine a runner
 * is on.
 */
export const RUNNER_ORIGIN_UNREACHABLE = "RUNNER_ORIGIN_UNREACHABLE";
/**
 * The runner refused the path over the relay: it serves only a closed list of
 * routes remotely (qontinui-runner `relay_path_policy.rs` `RELAY_ALLOWED`).
 * The action needs the runner on THIS machine.
 */
export const RUNNER_NEEDS_LOCAL = "RUNNER_NEEDS_LOCAL";
/**
 * The relay itself failed (backend relay-layer status: the runner is not
 * connected, not this user's device, timed out, or the body was too large).
 */
export const RUNNER_RELAY_FAILED = "RUNNER_RELAY_FAILED";

export class RunnerApiError extends Error {
  /**
   * The machine-readable code: the runner's origin-guard refusal
   * (`CROSS_ORIGIN_REFUSED`), or one of this module's RUNNER_* codes.
   */
  readonly code?: string;
  /** Set when the runner's origin guard refused this page's origin (loopback). */
  readonly originRefusal?: RunnerOriginRefusal;
  /** Relay-layer diagnostics, when the relay failed. */
  readonly relayDiagnostics?: RunnerRelayDiagnostics;
  /** How the request travelled, when a route was resolved. */
  readonly route?: RunnerRoute["kind"];

  constructor(
    public status: number,
    message: string,
    originRefusal?: RunnerOriginRefusal,
    extra?: {
      code?: string;
      relayDiagnostics?: RunnerRelayDiagnostics;
      route?: RunnerRoute["kind"];
    }
  ) {
    super(message);
    this.name = "RunnerApiError";
    this.originRefusal = originRefusal;
    this.relayDiagnostics = extra?.relayDiagnostics;
    this.route = extra?.route;
    this.code = originRefusal?.code ?? extra?.code;
  }
}

/**
 * Codes meaning "no runner can be reached right now" — rendered as offline.
 * A relay-path refusal is NOT one: the runner answered; the action is what
 * cannot be carried.
 */
const OFFLINE_CODES = new Set([
  RUNNER_LIST_UNAVAILABLE,
  RUNNER_LOCALITY_UNKNOWN,
  RUNNER_SELECTION_REQUIRED,
  RUNNER_ORIGIN_UNREACHABLE,
]);

function isOfflineError(err: RunnerApiError): boolean {
  if (err.code !== undefined && OFFLINE_CODES.has(err.code)) return true;
  // The relay's "runner not connected" (its one 503 emitter).
  return err.code === RUNNER_RELAY_FAILED && err.status === 503;
}

/** True when the runner refused this action over the relay: it needs the runner on this machine. */
export function isRunnerNeedsLocalError(error: unknown): boolean {
  return error instanceof RunnerApiError && error.code === RUNNER_NEEDS_LOCAL;
}

/**
 * The message to show for a failed runner action: the typed "needs the runner
 * on this machine" text when the relay refused it (so it is never flattened
 * into a generic failure), otherwise `fallback`.
 */
export function runnerFailureMessage(err: unknown, fallback: string): string {
  return isRunnerNeedsLocalError(err)
    ? (err as RunnerApiError).message
    : fallback;
}

function needsLocalMessage(target: RunnerTarget, path: string): string {
  const name = targetRunnerName(target);
  const who = name ? `"${name}"` : "The selected runner";
  return `This action needs the runner on this machine — ${who} is reached through the cloud relay, which does not carry ${path.split("?")[0]}`;
}

function refusalError(
  state: Extract<RunnerRouteState, { kind: "refused" | "measuring" }>,
  target: RunnerTarget
): RunnerApiError {
  const name = targetRunnerName(target);
  if (state.kind === "measuring") {
    return new RunnerApiError(
      0,
      `${name ? `"${name}"` : "The runner"} has not been resolved yet — the runner list or its locality check has not answered`,
      undefined,
      { code: RUNNER_LOCALITY_UNKNOWN }
    );
  }
  switch (state.reason) {
    case "list_unavailable":
      return new RunnerApiError(
        0,
        "The runner list could not be loaded, so no runner can be called",
        undefined,
        { code: RUNNER_LIST_UNAVAILABLE }
      );
    case "selection_required":
      return new RunnerApiError(
        0,
        "Several runners are paired and none is on this machine — choose one in the runner selector",
        undefined,
        { code: RUNNER_SELECTION_REQUIRED }
      );
    case "origin_unreachable":
      return new RunnerApiError(
        0,
        "Runner not reachable — loopback is only reachable from localhost dev origins, and no paired runner is listed to relay to",
        undefined,
        { code: RUNNER_ORIGIN_UNREACHABLE }
      );
  }
}

// =============================================================================
// runnerRequest — the raw, per-request resolver
// =============================================================================

export interface RunnerRequestInit extends RequestInit {
  /**
   * The caller's budget — the ONE deadline concept for a runner request.
   * Over loopback: the deadline until the response HEADERS arrive (the body
   * read is the caller's). Over the relay: `relayWaitMs(budget)` (floored at
   * RELAY_FLOOR_WAIT_MS, clamped to the backend's [1 s, 120 s]) is sent as
   * `X-Qontinui-Timeout-Ms` and the client gives up RELAY_DEADLINE_MARGIN_MS
   * after it, so the backend's structured 504 arrives first. Omitted: no
   * client deadline over loopback; the backend's 30 s default, sent
   * explicitly, over the relay. A caller that used to arm its own
   * AbortController timer passes its budget here instead — a bare abort
   * signal cannot tell the relay how long to wait.
   */
  timeoutMs?: number;
  /**
   * Send over THIS route instead of resolving one. The shared poll registry
   * pins each entry to the route it was keyed by.
   */
  route?: RunnerRoute;
}

/**
 * Send one request to the target runner and return the raw Response.
 *
 * The route is resolved now: loopback only for a runner proven local, the
 * relay for any other listed runner. Throws a typed {@link RunnerApiError}
 * when no request could be made (no target, no route), when nothing answered
 * (network failure, deadline), or when the runner refused the path over the
 * relay ({@link RUNNER_NEEDS_LOCAL}). Every other response — including a
 * non-2xx one — is returned for the caller to read.
 */
export async function runnerRequest(
  target: RunnerTarget,
  path: string,
  init: RunnerRequestInit = {}
): Promise<Response> {
  const { route: pinnedRoute, timeoutMs, ...rest } = init;
  const state =
    pinnedRoute ??
    (await resolveRunnerRoute(target, MEASURING_WAIT_MS, rest.signal));
  if (state.kind === "refused" || state.kind === "measuring") {
    throw refusalError(state, target);
  }
  const route = state;

  if (route.kind === "relay") {
    let response: Response;
    try {
      response = await relayRequest(route.runnerId, path, {
        ...rest,
        timeoutMs,
      });
    } catch (error) {
      if (rest.signal?.aborted) throw error;
      throw new RunnerApiError(
        0,
        `Runner relay request failed (${path}): ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        { code: RUNNER_RELAY_FAILED, route: "relay" }
      );
    }
    const refused = await readRelayPathRefusal(response);
    if (refused !== null) {
      throw new RunnerApiError(
        response.status,
        needsLocalMessage(target, path),
        undefined,
        { code: RUNNER_NEEDS_LOCAL, route: "relay" }
      );
    }
    return response;
  }

  // Loopback: a runner proven to be on this machine.
  const url = `${route.base}${path}`;
  const controller = new AbortController();
  const callerSignal = rest.signal ?? undefined;
  const forwardAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) forwardAbort();
  else callerSignal?.addEventListener("abort", forwardAbort, { once: true });
  let timedOut = false;
  const timeoutId =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
  try {
    // The caller's abort stays linked after the headers arrive: aborting it
    // is how a caller cancels a stalled BODY read (runnerFetch's deadline
    // covers the body). `once` detaches it on abort.
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (error) {
    callerSignal?.removeEventListener("abort", forwardAbort);
    if (timedOut) {
      throw new RunnerApiError(
        0,
        `Runner request timed out after ${Math.round((timeoutMs ?? 0) / 1000)}s (${path})`,
        undefined,
        { route: "loopback" }
      );
    }
    if (callerSignal?.aborted) throw error;
    if (error instanceof TypeError) {
      throw new RunnerApiError(
        0,
        `Runner not reachable — is qontinui-runner running at ${route.base}?`,
        undefined,
        { route: "loopback" }
      );
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

// =============================================================================
// runnerFetch — JSON over the resolved route
// =============================================================================

export interface RunnerFetchOptions extends RequestInit {
  /** Deadline for the whole call (headers and body). Defaults per route. */
  timeoutMs?: number;
  /** Send over this route instead of resolving one (shared-poll pinning). */
  route?: RunnerRoute;
}

export async function runnerFetch<T>(
  target: RunnerTarget,
  path: string,
  runnerOptions?: RunnerFetchOptions
): Promise<T> {
  const {
    route: pinnedRoute,
    timeoutMs: requestedTimeoutMs,
    ...options
  } = runnerOptions ?? {};

  const state =
    pinnedRoute ??
    (await resolveRunnerRoute(target, MEASURING_WAIT_MS, options.signal));
  if (state.kind === "refused" || state.kind === "measuring") {
    throw refusalError(state, target);
  }
  const route = state;
  // The one deadline concept: over the relay the budget becomes the relay
  // wait (sent to the backend), and this call's own deadline — over headers
  // AND body — sits RELAY_DEADLINE_MARGIN_MS beyond it so the backend's
  // structured 504 wins over a bare client abort.
  const relayWait =
    route.kind === "relay"
      ? relayWaitMs(requestedTimeoutMs ?? RELAY_TIMEOUT_MS)
      : undefined;
  const timeoutMs =
    relayWait !== undefined
      ? relayClientDeadlineMs(relayWait)
      : (requestedTimeoutMs ?? LOOPBACK_TIMEOUT_MS);

  // One deadline over headers AND body: a runner that sends headers and then
  // stalls the body cannot hang the caller.
  const controller = new AbortController();
  const callerSignal = options.signal ?? undefined;
  const forwardAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) forwardAbort();
  else callerSignal?.addEventListener("abort", forwardAbort, { once: true });
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const timeoutError = () =>
    new RunnerApiError(
      0,
      `Runner request timed out after ${Math.round(timeoutMs / 1000)}s (${path})`,
      undefined,
      { route: route.kind }
    );

  try {
    let response: Response;
    try {
      response = await runnerRequest(target, path, {
        ...options,
        route,
        // Over the relay: the relay wait (our deadline is beyond it).
        // Loopback is bounded by the controller above.
        timeoutMs: relayWait,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...headersRecord(options.headers),
        },
      });
    } catch (error) {
      if (timedOut) throw timeoutError();
      throw error;
    }

    if (!response.ok) {
      throw await errorForResponse(response, route, path, timedOut);
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (timedOut) throw timeoutError();
      throw error;
    }
    if (!text) return undefined as T;
    const json = JSON.parse(text);
    // Unwrap the ApiResponse envelope ({ success, data }) used by some
    // endpoints. This is the ONLY envelope unwrapped here: other endpoints
    // that return a named object — e.g. `/task-runs/running` ->
    // { scope, task_runs } — are handed back whole. Do not add per-endpoint
    // unwrapping; a generic fetch helper that guesses at payload shapes is how
    // a shape change goes unnoticed.
    if (
      json &&
      typeof json === "object" &&
      "success" in json &&
      "data" in json
    ) {
      return json.data as T;
    }
    return json as T;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", forwardAbort);
  }
}

function headersRecord(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

async function errorForResponse(
  response: Response,
  route: RunnerRoute,
  path: string,
  timedOut: boolean
): Promise<RunnerApiError> {
  if (route.kind === "loopback") {
    // A typed origin-guard refusal is not a broken runner — say what was
    // refused and how to admit it (see ./origin-refusal). Only a 403 can be
    // that refusal, so only a 403's body is read, under the call's deadline;
    // an aborted read degrades to the generic message.
    if (response.status === 403) {
      const refusal = await readRunnerOriginRefusal(response);
      if (refusal) {
        return new RunnerApiError(
          response.status,
          describeRunnerOriginRefusal(refusal),
          refusal,
          { route: "loopback" }
        );
      }
    }
    return new RunnerApiError(
      response.status,
      `Runner API error: ${response.status} ${response.statusText}`,
      undefined,
      { route: "loopback" }
    );
  }

  // Relay: a body with `detail` is the backend's relay layer speaking (the
  // runner answers `error`); carry its diagnostics so the failure names the
  // device, its WS clock and the request id to grep for.
  const diagnostics = timedOut ? {} : await readRelayDiagnostics(response);
  if (diagnostics.detail) {
    const ref = diagnostics.requestId
      ? ` (request ${diagnostics.requestId})`
      : "";
    return new RunnerApiError(
      response.status,
      `Runner relay error: ${response.status} ${diagnostics.detail} (${path.split("?")[0]})${ref}`,
      undefined,
      {
        code: RUNNER_RELAY_FAILED,
        relayDiagnostics: diagnostics,
        route: "relay",
      }
    );
  }
  return new RunnerApiError(
    response.status,
    `Runner API error: ${response.status} ${response.statusText}`,
    undefined,
    { route: "relay" }
  );
}

// =============================================================================
// Shared Poll Registry — deduplicates concurrent polls to the same endpoint
// =============================================================================

type PollListener = (raw: unknown, err: Error | null) => void;

interface SharedPollEntry {
  /** The runner path this entry polls */
  path: string;
  /** The target and route this entry polls over — fixed for its lifetime */
  target: RunnerTarget;
  route: RunnerRoute;
  /** The setInterval ID (null when paused or no polling) */
  intervalId: NodeJS.Timeout | null;
  /** The active poll interval in ms (0 = no polling) */
  intervalMs: number;
  /** Callbacks to notify when new data arrives, mapped to their requested poll interval */
  listeners: Map<PollListener, number>;
  /** Latest cached result */
  lastResult: unknown;
  /** Latest error */
  lastError: Error | null;
  /** In-flight fetch promise (prevents overlapping requests) */
  pending: Promise<void> | null;
  /**
   * The relay refused this path: it is not carried remotely, and asking again
   * cannot change that, so the entry stops polling.
   */
  refusedRemotely: boolean;
}

/**
 * Keyed by target + route AND path: a result fetched from one runner (or over
 * one transport) is never served to a subscriber of another, including a
 * response that lands after the active runner changed.
 */
const _sharedPolls = new Map<string, SharedPollEntry>();

function sharedPollKey(activeTargetKey: string, path: string): string {
  return `${activeTargetKey}|${path}`;
}

/**
 * The interval a subscriber's request actually runs at over `route`: never
 * faster than RELAY_POLL_INTERVAL_MS over the relay.
 */
export function effectivePollInterval(
  route: RunnerRoute,
  requestedMs: number
): number {
  if (requestedMs <= 0) return 0;
  return route.kind === "relay"
    ? Math.max(requestedMs, RELAY_POLL_INTERVAL_MS)
    : requestedMs;
}

/**
 * The interval a poll of `target` should wait before its next tick:
 * `requestedMs` only when the target's route is loopback (proven local, or
 * the empty-list default); RELAY_POLL_INTERVAL_MS at the fastest for a relayed
 * target AND for one not resolved yet (measuring / refused) — an unresolved
 * target may resolve to the relay, and must not be polled at loopback speed
 * meanwhile. Every hand-rolled poller goes through this (or through
 * startRunnerPoll / useRunnerPoll, which call it on every tick); the shared
 * useRunnerQuery registry applies the same rule via effectivePollInterval.
 */
export function runnerPollInterval(
  target: RunnerTarget,
  requestedMs: number
): number {
  if (requestedMs <= 0) return requestedMs;
  const route = routeOfTarget(target);
  if (route.kind === "loopback") return requestedMs;
  return Math.max(requestedMs, RELAY_POLL_INTERVAL_MS);
}

/** What a poll tick tells the poller: keep going, or stop for good. */
export type RunnerPollTickResult = void | "stop";

/**
 * Run `tick` repeatedly against a runner, re-evaluating the cadence on EVERY
 * tick (`runnerPollInterval(getTarget(), requestedMs)`), so a target that
 * resolves to — or away from — the relay mid-poll changes speed at once.
 *
 * Stops for good when `tick` returns "stop", or when it throws a
 * RUNNER_NEEDS_LOCAL error: the runner refused the path over the relay and
 * asking again cannot change that (`onNeedsLocal` receives the error so the
 * caller can render it). Any other thrown error is passed to `onError` and
 * polling continues. The first tick runs after one interval unless
 * `immediate`. Returns a stop function.
 */
export function startRunnerPoll(options: {
  getTarget: () => RunnerTarget;
  requestedMs: number;
  tick: () => Promise<RunnerPollTickResult> | RunnerPollTickResult;
  onNeedsLocal?: (error: RunnerApiError) => void;
  onError?: (error: unknown) => void;
  immediate?: boolean;
}): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(
      run,
      runnerPollInterval(options.getTarget(), options.requestedMs)
    );
  };
  const run = async () => {
    if (stopped) return;
    try {
      if ((await options.tick()) === "stop") {
        stopped = true;
        return;
      }
    } catch (error) {
      if (isRunnerNeedsLocalError(error)) {
        stopped = true;
        options.onNeedsLocal?.(error as RunnerApiError);
        return;
      }
      options.onError?.(error);
    }
    schedule();
  };
  if (options.immediate) void run();
  else schedule();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}

/**
 * Wait before the next iteration of an imperative polling LOOP (a
 * `while (!done) { ...; await runnerPollDelay(target, ms) }` wait-for-
 * completion). Re-evaluated on each call, like startRunnerPoll.
 */
export function runnerPollDelay(
  target: RunnerTarget,
  requestedMs: number,
  signal?: AbortSignal | null
): Promise<void> {
  const ms = runnerPollInterval(target, requestedMs);
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Compute the fastest requested interval from all listeners (0 means no polling) */
function computeMinInterval(entry: SharedPollEntry): number {
  let min = 0;
  entry.listeners.forEach((requestedMs) => {
    if (requestedMs > 0) {
      min = min === 0 ? requestedMs : Math.min(min, requestedMs);
    }
  });
  return effectivePollInterval(entry.route, min);
}

function sharedFetch(entry: SharedPollEntry): Promise<void> {
  if (entry.pending) return entry.pending;
  entry.pending = runnerFetch<unknown>(entry.target, entry.path, {
    route: entry.route,
  })
    .then((raw) => {
      entry.lastResult = raw;
      entry.lastError = null;
      entry.listeners.forEach((_interval, cb) => cb(raw, null));
    })
    .catch((err) => {
      entry.lastError = err instanceof Error ? err : new Error(String(err));
      if (isRunnerNeedsLocalError(err)) {
        entry.refusedRemotely = true;
        stopSharedPolling(entry);
      }
      entry.listeners.forEach((_interval, cb) => cb(null, entry.lastError));
    })
    .finally(() => {
      entry.pending = null;
    });
  return entry.pending;
}

function startSharedPolling(entry: SharedPollEntry) {
  stopSharedPolling(entry);
  if (entry.intervalMs > 0 && !entry.refusedRemotely) {
    entry.intervalId = setInterval(() => sharedFetch(entry), entry.intervalMs);
  }
}

function stopSharedPolling(entry: SharedPollEntry) {
  if (entry.intervalId) {
    clearInterval(entry.intervalId);
    entry.intervalId = null;
  }
}

// Pause/resume all shared polls on visibility change
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      _sharedPolls.forEach((entry) => stopSharedPolling(entry));
    } else {
      _sharedPolls.forEach((entry) => {
        if (entry.refusedRemotely) return;
        sharedFetch(entry);
        startSharedPolling(entry);
      });
    }
  });
}

// =============================================================================
// Target measurement for hooks
// =============================================================================

/**
 * The target with its locality filled in when it names a runner the caller
 * did not measure (a target built outside the ActiveRunnerProvider). The
 * provider's own targets always carry their measurement, so this only probes
 * for hand-built ones.
 */
function useMeasuredTarget(target: RunnerTarget): RunnerTarget {
  const needsProbe = target.kind === "runner" && target.locality === undefined;
  const probeKey =
    target.kind === "runner"
      ? `${target.runner.id}:${target.runner.port ?? ""}`
      : "";
  const [measured, setMeasured] = useState<{
    key: string;
    locality: RunnerLocality;
  } | null>(null);

  useEffect(() => {
    if (!needsProbe || target.kind !== "runner") return;
    let cancelled = false;
    void measureRunnerLocality(target.runner).then((locality) => {
      if (!cancelled) setMeasured({ key: probeKey, locality });
    });
    return () => {
      cancelled = true;
    };
    // Keyed by the runner's (id, port); the object identity may churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsProbe, probeKey]);

  if (needsProbe && target.kind === "runner" && measured?.key === probeKey) {
    return { ...target, locality: measured.locality };
  }
  return target;
}

// =============================================================================
// Generic Query Hook
// =============================================================================

export interface UseRunnerQueryOptions<T = unknown> {
  enabled?: boolean;
  /**
   * Requested poll interval. Over the relay it is raised to
   * RELAY_POLL_INTERVAL_MS at the least.
   */
  pollInterval?: number;
  /** Transform the raw API response before storing (e.g. unwrap nested fields) */
  transform?: (raw: unknown) => T;
}

export interface UseRunnerQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  /** The typed code of the current error (a RUNNER_* code or CROSS_ORIGIN_REFUSED), if any. */
  errorCode: string | null;
  isOffline: boolean;
  refetch: () => Promise<void>;
}

export function useRunnerQuery<T>(
  target: RunnerTarget,
  path: string | null,
  options?: UseRunnerQueryOptions<T>
): UseRunnerQueryResult<T> {
  // Data is stored with the target+route key it was fetched under and
  // rendered only while that key is still the active one: a previous
  // runner's (or transport's) answer is never shown as the new one's, not
  // even for the one render before an effect could clear it.
  const [dataEntry, setDataEntry] = useState<{
    targetKey: string;
    value: T;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const enabled = options?.enabled !== false;
  const pollInterval = options?.pollInterval ?? 0;
  const transformRef = useRef(options?.transform);
  transformRef.current = options?.transform;

  const measuredTarget = useMeasuredTarget(target);
  const routeState = routeOfTarget(measuredTarget);
  const activeTargetKey = targetKey(measuredTarget);
  // The latest target for this key (keys are equal exactly when the route is).
  const targetRef = useRef(measuredTarget);
  targetRef.current = measuredTarget;

  const pollKey = path === null ? null : sharedPollKey(activeTargetKey, path);
  const data =
    dataEntry !== null && dataEntry.targetKey === activeTargetKey
      ? dataEntry.value
      : null;

  const applyResult = useCallback(
    (fetchedUnder: string, raw: unknown, err: Error | null) => {
      if (err) {
        if (err instanceof RunnerApiError) {
          setError(err.message);
          setErrorCode(err.code ?? null);
          setIsOffline(isOfflineError(err));
        } else {
          setIsOffline(true);
          setError("Runner not connected");
          setErrorCode(null);
        }
      } else {
        const result = transformRef.current
          ? transformRef.current(raw)
          : (raw as T);
        setDataEntry({ targetKey: fetchedUnder, value: result });
        setError(null);
        setErrorCode(null);
        setIsOffline(false);
      }
      setIsLoading(false);
    },
    []
  );

  const routeKind = routeState.kind;
  useEffect(() => {
    if (!enabled || !path || !pollKey) {
      setIsLoading(false);
      return;
    }

    const state = routeOfTarget(targetRef.current);
    // Not resolved yet: stay loading, never fetch.
    if (state.kind === "measuring") {
      setIsLoading(true);
      setError(null);
      setErrorCode(null);
      setIsOffline(false);
      return;
    }
    // No route: report the typed refusal without starting a timer.
    if (state.kind === "refused") {
      const err = refusalError(state, targetRef.current);
      setIsOffline(true);
      setError(err.message);
      setErrorCode(err.code ?? null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // One listener per subscription, tagged with the key its results were
    // fetched under.
    const listener: PollListener = (raw, err) =>
      applyResult(activeTargetKey, raw, err);

    let entry = _sharedPolls.get(pollKey);
    if (entry) {
      // Join existing shared poll — track this listener's requested interval
      entry.listeners.set(listener, pollInterval);
      const newMin = computeMinInterval(entry);
      if (newMin !== entry.intervalMs) {
        entry.intervalMs = newMin;
        if (newMin > 0) {
          startSharedPolling(entry);
        } else {
          stopSharedPolling(entry);
        }
      }
      // Serve cached data immediately if available
      if (entry.lastResult !== undefined) {
        listener(entry.lastResult, null);
      } else if (entry.lastError) {
        listener(null, entry.lastError);
      } else {
        // A fetch is likely already in-flight from the first subscriber
        sharedFetch(entry);
      }
    } else {
      entry = {
        path,
        target: targetRef.current,
        route: state,
        intervalId: null,
        intervalMs: effectivePollInterval(state, pollInterval),
        listeners: new Map([[listener, pollInterval]]),
        lastResult: undefined,
        lastError: null,
        pending: null,
        refusedRemotely: false,
      };
      _sharedPolls.set(pollKey, entry);
      sharedFetch(entry);
      startSharedPolling(entry);
    }

    return () => {
      const e = _sharedPolls.get(pollKey);
      if (!e) return;
      e.listeners.delete(listener);
      if (e.listeners.size === 0) {
        stopSharedPolling(e);
        _sharedPolls.delete(pollKey);
      } else {
        // Recalculate interval — a fast poller may have just left
        const newMin = computeMinInterval(e);
        if (newMin !== e.intervalMs) {
          e.intervalMs = newMin;
          if (newMin > 0) {
            startSharedPolling(e);
          } else {
            stopSharedPolling(e);
          }
        }
      }
    };
  }, [
    pollKey,
    pollInterval,
    enabled,
    applyResult,
    path,
    activeTargetKey,
    routeKind,
  ]);

  const refetch = useCallback(async () => {
    if (!pollKey) return;
    const entry = _sharedPolls.get(pollKey);
    if (entry) {
      await sharedFetch(entry);
    }
  }, [pollKey]);

  return { data, isLoading, error, errorCode, isOffline, refetch };
}

// =============================================================================
// Mutation Hook
// =============================================================================

export interface UseRunnerMutationResult<TInput, TOutput> {
  mutate: (input: TInput) => Promise<TOutput>;
  isLoading: boolean;
  error: string | null;
}

export function useRunnerMutation<TInput, TOutput>(
  target: RunnerTarget,
  path: string,
  method: string = "POST"
): UseRunnerMutationResult<TInput, TOutput> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (input: TInput): Promise<TOutput> => {
      setIsLoading(true);
      setError(null);
      try {
        return await runnerFetch<TOutput>(target, path, {
          method,
          body: JSON.stringify(input),
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Runner mutation failed";
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [target, path, method]
  );

  return { mutate, isLoading, error };
}

// =============================================================================
// Poll Hook — hand-rolled polling with the relay cadence and the refusal stop
// =============================================================================

/**
 * Poll `tick` while `enabled`, via startRunnerPoll: the interval is
 * re-evaluated for the CURRENT target on every tick, and polling stops for
 * good on a RUNNER_NEEDS_LOCAL refusal (reported through `onNeedsLocal`).
 * Restarts when `enabled`, `requestedMs` or the target's key change. `tick`
 * and the callbacks are read through refs, so they need not be stable.
 */
export function useRunnerPoll(
  target: RunnerTarget,
  options: {
    enabled: boolean;
    requestedMs: number;
    tick: () => Promise<RunnerPollTickResult> | RunnerPollTickResult;
    onNeedsLocal?: (error: RunnerApiError) => void;
    onError?: (error: unknown) => void;
    immediate?: boolean;
  }
): void {
  const targetRef = useRef(target);
  targetRef.current = target;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const key = targetKey(target);
  const { enabled, requestedMs, immediate } = options;

  useEffect(() => {
    if (!enabled) return;
    return startRunnerPoll({
      getTarget: () => targetRef.current,
      requestedMs,
      immediate,
      tick: () => optionsRef.current.tick(),
      onNeedsLocal: (e) => optionsRef.current.onNeedsLocal?.(e),
      onError: (e) => optionsRef.current.onError?.(e),
    });
  }, [enabled, requestedMs, immediate, key]);
}
