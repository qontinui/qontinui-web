/**
 * GET a path on a paired runner named only by its device id.
 *
 * Goes through the app's one runner transport resolver (`runnerRequest`,
 * `@/lib/runner/api-client`). A runner named by device id alone carries no
 * port, so it can never be proven local and the resolver always takes the
 * relay (`@/lib/runner/relay` — the one relay client), which reaches the
 * runner by device id from any origin. The runner's Spec API and live UI
 * Bridge snapshot are on its relay allowlist.
 *
 * This module keeps the digital twin's error shape: a {@link RunnerRelayError}
 * carrying the backend's relay diagnostics and, when the runner itself
 * answered, the runner's own refusal. It is also the ONE place a runner body
 * is unwrapped — see {@link runnerProxyGet}.
 */

import { runnerRequest, RunnerApiError } from "@/lib/runner/api-client";
import {
  readRelayDiagnostics,
  type RunnerRelayDiagnostics,
} from "@/lib/runner/relay";
import type { RunnerTarget } from "@/lib/runner/target";

export type { RunnerRelayDiagnostics } from "@/lib/runner/relay";

/**
 * The runner's own refusal — the RUNNER speaking, as opposed to the backend's
 * relay layer (whose `detail` and clocks `readRelayDiagnostics` reads). Two
 * runner dialects reach this tab:
 *  - the Spec API's `SpecError`: `{ ok: false, reason, detail? }` — e.g. the
 *    404 `{ ok: false, reason: "app-not-found", detail: { appId } }` for an
 *    app id the runner has not registered;
 *  - an `ApiResponse` error: `{ success: false, error, code? }` — e.g. the
 *    snapshot route's 500 when neither the SDK nor a native capture answered.
 */
export interface RunnerRefusal {
  /** Machine-readable cause: the Spec API's `reason`, else the `code`. */
  reason?: string;
  /** Human-readable message: the `ApiResponse` `error`. */
  message?: string;
  /** Structured detail the runner attached (Spec API `detail`), verbatim. */
  detail?: Record<string, unknown>;
}

export class RunnerRelayError extends Error {
  readonly detail?: string;
  readonly deviceId?: string;
  readonly wsConnectedAt?: string | null;
  readonly lastSeenAt?: string | null;
  readonly requestId?: string;
  /** The typed RunnerApiError code, when the resolver refused (e.g. RUNNER_NEEDS_LOCAL). */
  readonly code?: string;
  /**
   * The runner's own refusal, when the body was the runner speaking. Its
   * presence proves the relay worked end to end: the runner answered.
   */
  readonly runner?: RunnerRefusal;

  constructor(
    message: string,
    readonly status?: number,
    diagnostics: RunnerRelayDiagnostics = {},
    code?: string,
    runner?: RunnerRefusal
  ) {
    super(message);
    this.name = "RunnerRelayError";
    this.detail = diagnostics.detail;
    this.deviceId = diagnostics.deviceId;
    this.wsConnectedAt = diagnostics.wsConnectedAt;
    this.lastSeenAt = diagnostics.lastSeenAt;
    this.requestId = diagnostics.requestId;
    this.code = code;
    this.runner = runner;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const nonEmpty = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : undefined;

/**
 * The runner's refusal in `body`, or `undefined` when the body does not say
 * it failed. A body that says so (`ok: false` or `success: false`) is a
 * refusal even when it names no cause — the runner still answered "no".
 */
export function readRunnerRefusal(body: unknown): RunnerRefusal | undefined {
  if (!isRecord(body)) return undefined;
  if (body.ok !== false && body.success !== false) return undefined;
  return {
    reason: nonEmpty(body.reason) ?? nonEmpty(body.code),
    message: nonEmpty(body.error),
    detail: isRecord(body.detail) ? body.detail : undefined,
  };
}

/** `": <reason>"`, `": <reason> — <message>"`, or `""` when it named no cause. */
function refusalSuffix(r: RunnerRefusal): string {
  const words = [r.reason, r.message].filter(Boolean).join(" — ");
  return words ? `: ${words}` : "";
}

async function readJsonOrUndefined(resp: Response): Promise<unknown> {
  try {
    return await resp.json();
  } catch {
    return undefined;
  }
}

/**
 * GET `runnerPath` (e.g. `apps/qontinui-runner/spec/list`) on `deviceId`'s
 * runner and return its payload. Throws {@link RunnerRelayError} on a
 * transport failure, a non-2xx, or a body that says it failed, so React Query
 * surfaces each as an error state.
 *
 * The runner speaks two body shapes, and both relay hops pass the body through
 * verbatim. Its `ApiResponse` routes wrap the payload as
 * `{ success: true, data }` (the live snapshot does); the Spec API answers
 * bare (`{ ok, specs }`, `{ ok, pages }`). The envelope is unwrapped HERE,
 * once, for every runner-proxy read — callers always receive the payload.
 * Leaving it to each caller is how the snapshot counters read the envelope's
 * top level and showed "0 elements" for a 112-element snapshot.
 *
 * `{ success: false, error }` (or the Spec API's `{ ok: false, reason }`) is
 * an ERROR even on a 2xx, never an empty success: a failed read rendered as an
 * empty result is a confident wrong answer.
 */
export async function runnerProxyGet<T>(
  deviceId: string,
  runnerPath: string,
  opts?: { timeoutMs?: number }
): Promise<T> {
  const path = runnerPath.replace(/^\//, "");
  const target: RunnerTarget = {
    kind: "runner",
    runner: { id: deviceId },
    locality: undefined,
  };

  let resp: Response;
  try {
    resp = await runnerRequest(target, `/${path}`, {
      method: "GET",
      timeoutMs: opts?.timeoutMs,
    });
  } catch (err) {
    if (err instanceof RunnerApiError) {
      throw new RunnerRelayError(
        err.message,
        err.status || undefined,
        {},
        err.code
      );
    }
    throw new RunnerRelayError(
      err instanceof Error ? err.message : "runner not reachable"
    );
  }
  if (!resp.ok) {
    // One body, two possible speakers: the backend's relay layer (`detail`,
    // clocks, request id) or the runner itself (its refusal). Read the
    // runner's half from a clone — `readRelayDiagnostics` consumes the body.
    const runner = readRunnerRefusal(await readJsonOrUndefined(resp.clone()));
    const diagnostics = await readRelayDiagnostics(resp);
    // Put the cause and the request id in the message itself: this string is
    // what React Query surfaces and what lands in the console, and the id is
    // only useful if the person reading it can see it.
    const because = diagnostics.detail
      ? `: ${diagnostics.detail}`
      : runner
        ? refusalSuffix(runner)
        : "";
    const ref = diagnostics.requestId
      ? ` (request ${diagnostics.requestId})`
      : "";
    throw new RunnerRelayError(
      `runner returned HTTP ${resp.status} for ${path}${because}${ref}`,
      resp.status,
      diagnostics,
      undefined,
      runner
    );
  }

  const body: unknown = await resp.json();
  const refused = readRunnerRefusal(body);
  if (refused) {
    // A 2xx body is all the runner's, so there are no relay diagnostics to
    // read — but the backend still stamps its request id on the response
    // header, and a refusal that came back as a success is the hardest one to
    // trace without it.
    const requestId = nonEmpty(resp.headers.get("X-Request-ID"));
    const ref = requestId ? ` (request ${requestId})` : "";
    throw new RunnerRelayError(
      `runner answered HTTP ${resp.status} for ${path} with a failure${refusalSuffix(refused)}${ref}`,
      resp.status,
      { requestId },
      undefined,
      refused
    );
  }
  if (isRecord(body) && body.success === true && "data" in body) {
    return body.data as T;
  }
  return body as T;
}
