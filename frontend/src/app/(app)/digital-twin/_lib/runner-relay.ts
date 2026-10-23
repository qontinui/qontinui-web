/**
 * GET or POST a path on a paired runner named only by its device id.
 *
 * Goes through the app's one runner transport resolver (`runnerRequest`,
 * `@/lib/runner/api-client`). A runner named by device id alone carries no
 * port, so it can never be proven local and the resolver always takes the
 * relay (`@/lib/runner/relay` — the one relay client), which reaches the
 * runner by device id from any origin. The runner's Spec API and live UI
 * Bridge snapshot are on its relay allowlist, and so are the two reads the
 * console's UI Bridge dashboard adds (`admin/coord/ui-bridge/_lib/relayReads.ts`).
 *
 * This module keeps the digital twin's error shape: a {@link RunnerRelayError}
 * carrying the backend's relay diagnostics and, when the runner itself
 * answered, the runner's own refusal. It is also the ONE place a runner body
 * is unwrapped — see {@link runnerProxyGet} — and the one place a relayed
 * POST is built — see {@link runnerProxyPost}.
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
 * relay layer (whose `detail` and clocks `readRelayDiagnostics` reads). Three
 * runner dialects reach these reads:
 *  - the Spec API's `SpecError`: `{ ok: false, reason, detail? }` — e.g. the
 *    404 `{ ok: false, reason: "app-not-found", detail: { appId } }` for an
 *    app id the runner has not registered;
 *  - an `ApiResponse` error: `{ success: false, error, code? }` — e.g. the
 *    snapshot route's 500 when neither the SDK nor a native capture answered;
 *  - the relay's egress refusal: `409 { error: "egress_off", flow, domain,
 *    message }` (qontinui-runner `backend_relay.rs`
 *    `egress_off_http_response`), sent INSTEAD of the route's answer when the
 *    project's switch for that flow is off — the snapshot and page health
 *    follow the terminal-stream switch, because both quote the runner's own
 *    window. It carries no `success: false`, so it is matched by its fixed
 *    `error` token; `reason` is then `egress_off`, `message` the runner's
 *    sentence, and `detail` the `flow` / `domain` it named.
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
 * The fixed `error` token of the runner relay's egress refusal. A machine
 * token, not a sentence, so matching it is the contract (the sentence beside
 * it is `message`).
 */
export const EGRESS_OFF_REFUSAL = "egress_off";

/**
 * The runner's refusal in `body`, or `undefined` when the body does not say
 * it failed. A body that says so (`ok: false` or `success: false`) is a
 * refusal even when it names no cause — the runner still answered "no". The
 * relay's egress refusal says so by its `error: "egress_off"` token instead
 * (see {@link RunnerRefusal}).
 */
export function readRunnerRefusal(body: unknown): RunnerRefusal | undefined {
  if (!isRecord(body)) return undefined;
  if (body.error === EGRESS_OFF_REFUSAL) {
    const detail: Record<string, unknown> = {};
    const flow = nonEmpty(body.flow);
    const domain = nonEmpty(body.domain);
    if (flow) detail.flow = flow;
    if (domain) detail.domain = domain;
    return {
      reason: EGRESS_OFF_REFUSAL,
      message: nonEmpty(body.message),
      detail: Object.keys(detail).length > 0 ? detail : undefined,
    };
  }
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

/** Options for one runner-proxy request. */
export interface RunnerProxyOptions {
  /** The caller's budget — see `RunnerRequestInit.timeoutMs`. */
  timeoutMs?: number;
  /**
   * What an `ApiResponse` success envelope (`{ success: true, data }`) hands
   * back:
   *  - `"unwrap"` (the default) — its `data`, the payload. Right for every
   *    route whose envelope carries nothing beside `data`.
   *  - `"keep"` — the whole body, for a route whose envelope carries fields
   *    BESIDE `data`. The runner's `/health` is one: its SDK feature inventory
   *    (`sdkFeatures`), `uiBridge`, `buildId` and `provenance` sit at the top
   *    level, so unwrapping it would silently drop the feature inventory.
   *
   * Either way a body that says it failed is an error, never a value.
   */
  envelope?: "unwrap" | "keep";
}

/** The request half that differs between {@link runnerProxyGet} and {@link runnerProxyPost}. */
interface RunnerProxyInit {
  method: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
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
 * once, for every runner-proxy read — callers always receive the payload
 * unless they ask for the whole body (`envelope: "keep"`, see
 * {@link RunnerProxyOptions}). Leaving it to each caller is how the snapshot
 * counters read the envelope's top level and showed "0 elements" for a
 * 112-element snapshot.
 *
 * `{ success: false, error }` (or the Spec API's `{ ok: false, reason }`) is
 * an ERROR even on a 2xx, never an empty success: a failed read rendered as an
 * empty result is a confident wrong answer.
 */
export async function runnerProxyGet<T>(
  deviceId: string,
  runnerPath: string,
  opts?: RunnerProxyOptions
): Promise<T> {
  return runnerProxyRequest<T>(deviceId, runnerPath, { method: "GET" }, opts);
}

/**
 * POST `body`, JSON-encoded, to `runnerPath` on `deviceId`'s runner and return
 * its payload — the POST twin of {@link runnerProxyGet}, with the same error
 * and envelope contract.
 *
 * Some runner READS are registered as POST routes (page health takes an
 * options body; the occlusion sweep takes a threshold), so the relay carries
 * them as POST. The method is the route's, not a claim that the call writes:
 * the relay carries only the `(method, path)` pairs the runner's allowlist
 * names, and a POST outside it is refused like any other path.
 *
 * The body always goes as JSON with an explicit `Content-Type`, on the relay
 * AND on loopback, so the runner's `Json` extractor never depends on the HTTP
 * client's default header.
 */
export async function runnerProxyPost<T>(
  deviceId: string,
  runnerPath: string,
  body: unknown,
  opts?: RunnerProxyOptions
): Promise<T> {
  return runnerProxyRequest<T>(
    deviceId,
    runnerPath,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
    opts
  );
}

async function runnerProxyRequest<T>(
  deviceId: string,
  runnerPath: string,
  init: RunnerProxyInit,
  opts?: RunnerProxyOptions
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
      method: init.method,
      body: init.body,
      headers: init.headers,
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
  if (
    opts?.envelope !== "keep" &&
    isRecord(body) &&
    body.success === true &&
    "data" in body
  ) {
    return body.data as T;
  }
  return body as T;
}
