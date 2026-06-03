/**
 * planClient.ts
 *
 * Phase 1 of the web co-pilot: turn a natural-language prompt into a grounded
 * action plan by delegating to the paired runner's local Claude Code planner.
 *
 * The request is forwarded by the web backend's device-bridge runner proxy
 * (`POST /api/v1/device-bridge/runner-proxy/prompt-home/plan`) HTTP-over-WS to
 * the runner identified by the `X-Qontinui-Device-Id` header. The runner runs
 * its `plan_intent_handler` (see
 * `qontinui-runner/src-tauri/src/mcp/prompt_home.rs`) and returns an
 * `ApiResponse<{summary, steps[]}>` envelope (`{success, data, error}`), which
 * the proxy relays verbatim.
 *
 * This module is a pure async client: no React, no global state. The hook
 * (`usePromptExecution`) owns device-id resolution and orchestration.
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";
import { buildPageCatalog } from "./pageCatalog";
import { copilotPages } from "./pageMap";

/**
 * One planned step. Mirrors the runner's `PlanStep` (prompt_home.rs):
 *   - `navigate` carries a `target` page id (resolved to a URL by the executor).
 *   - `action` carries a natural-language `instruction` dispatched to the tab.
 * `explanation` is always present (human-readable rationale).
 */
export interface PlanStep {
  type: "navigate" | "action";
  /** Page id for `navigate` steps (e.g. "build-workflows"). */
  target?: string;
  /** NL instruction for `action` steps (e.g. "click the Create Workflow button"). */
  instruction?: string;
  /** Why this step exists — shown in the plan preview. */
  explanation: string;
}

/** The planner's full result: a summary line plus the ordered steps. */
export interface PlanIntentResult {
  summary: string;
  steps: PlanStep[];
}

/**
 * Discriminated reason a plan request failed. The hook maps these onto the
 * user-facing error affordances (re-auth, connect-runner, retry, etc.).
 */
export type PlanErrorReason =
  /** Caller passed no device id — should have been pre-checked. */
  | "no-device-id"
  /** 401/403 — the web session bearer expired; re-authenticate. */
  | "auth-required"
  /** 404 — the device id isn't a runner owned by this user. */
  | "device-not-owned"
  /** 503 — the runner is not WebSocket-connected (or no browser tab). */
  | "runner-not-connected"
  /** 400/413/422 — prompt empty, too long, or otherwise rejected. */
  | "prompt-rejected"
  /** 502/504 — the relay transport to the runner failed/timed out. */
  | "runner-unreachable"
  /** The runner returned success but the plan JSON was malformed. */
  | "malformed-plan"
  /** Any other unexpected failure (network, 5xx, AI error). */
  | "planning-failed";

/** Typed error thrown by `requestPlan`, carrying the discriminated reason. */
export class PlanError extends Error {
  readonly reason: PlanErrorReason;
  /** Upstream HTTP status when the failure originated from a response. */
  readonly status?: number;

  constructor(reason: PlanErrorReason, message: string, status?: number) {
    super(message);
    this.name = "PlanError";
    this.reason = reason;
    this.status = status;
  }
}

/** Runner-proxy planner endpoint (relative to the API base; httpClient prefixes it). */
const PLAN_PATH =
  "/api/v1/device-bridge/runner-proxy/prompt-home/plan";

/** Header the runner-proxy reads to relay to a specific paired runner. */
const DEVICE_ID_HEADER = "X-Qontinui-Device-Id";

/**
 * Per-request relay timeout, in ms, sent to the web backend via
 * `X-Qontinui-Timeout-Ms`. The backend (`device_bridge_ws.py`) clamps this to
 * [1s, 120s] and uses it instead of the relay's 30s default. Runner planning
 * routinely takes ~20s+ (more with explain-mode / complex prompts), so the 30s
 * default produced spurious 504s. We give planning the largest sync window that
 * still clears the upstream API gateway's hard ~60s request cap.
 */
const PLAN_RELAY_TIMEOUT_MS = 55000;
const PLAN_TIMEOUT_HEADER = "X-Qontinui-Timeout-Ms";

/**
 * Client-side hard deadline for the whole plan fetch, in ms. Set slightly above
 * the relay timeout (so the server-side timeout normally wins and returns a
 * structured 504) but well under any indefinite hang: if the fetch promise has
 * not settled by this point we abort it and throw a `runner-unreachable`
 * PlanError, so the UI can never sit on "Planning…" forever.
 */
const PLAN_CLIENT_TIMEOUT_MS = 58000;

/** Sentinel returned by the client-side timeout race (never resolves the fetch). */
const PLAN_TIMEOUT_SENTINEL = Symbol("plan-client-timeout");

export interface RequestPlanInput {
  /** Raw user prompt. */
  prompt: string;
  /** The active paired runner's id (used as the relay device id). */
  deviceId: string | null | undefined;
  /** When true, the planner produces detailed per-step explanations. */
  explain: boolean;
}

/**
 * The runner's `ApiResponse<T>` envelope shape. The proxy relays it verbatim,
 * so a 200 response body carries `{success, data?, error?}`.
 */
interface RunnerApiResponse {
  success?: unknown;
  data?: unknown;
  error?: unknown;
}

/**
 * Type guard: validate the unwrapped plan `data` is a well-formed
 * `PlanIntentResult` (summary string + array of well-formed steps).
 */
function isPlanIntentResult(value: unknown): value is PlanIntentResult {
  if (value === null || typeof value !== "object") return false;
  const v = value as { summary?: unknown; steps?: unknown };
  if (typeof v.summary !== "string") return false;
  if (!Array.isArray(v.steps)) return false;
  return v.steps.every(isPlanStep);
}

/** Validate one step has a known `type`, an `explanation`, and the field its type requires. */
function isPlanStep(value: unknown): value is PlanStep {
  if (value === null || typeof value !== "object") return false;
  const v = value as {
    type?: unknown;
    target?: unknown;
    instruction?: unknown;
    explanation?: unknown;
  };
  if (v.type !== "navigate" && v.type !== "action") return false;
  if (typeof v.explanation !== "string") return false;
  if (v.target !== undefined && typeof v.target !== "string") return false;
  if (v.instruction !== undefined && typeof v.instruction !== "string") {
    return false;
  }
  // A navigate step needs a target; an action step needs an instruction.
  if (v.type === "navigate" && typeof v.target !== "string") return false;
  if (v.type === "action" && typeof v.instruction !== "string") return false;
  return true;
}

/** Map an HTTP status from the runner-proxy onto a `PlanErrorReason`. */
function reasonForStatus(status: number): PlanErrorReason {
  if (status === 401 || status === 403) return "auth-required";
  if (status === 404) return "device-not-owned";
  if (status === 503) return "runner-not-connected";
  if (status === 502 || status === 504) return "runner-unreachable";
  if (status === 400 || status === 413 || status === 422) {
    return "prompt-rejected";
  }
  return "planning-failed";
}

/** Best-effort extraction of a human message from a JSON or text error body. */
async function extractErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const clone = response.clone();
    const body = (await clone.json()) as {
      detail?: unknown;
      error?: unknown;
      message?: unknown;
    };
    const candidate = body.detail ?? body.error ?? body.message;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  } catch {
    /* not JSON — fall through to text */
  }
  try {
    const text = await response.text();
    if (text.trim().length > 0) return text.slice(0, 500);
  } catch {
    /* ignore */
  }
  return fallback;
}

/**
 * Request an action plan for `prompt` from the paired runner.
 *
 * Builds the page catalog + page list locally (so the planner grounds on the
 * web app's real pages/labels), POSTs to the runner-proxy planner endpoint with
 * the device header, unwraps the runner `ApiResponse`, and validates the plan
 * shape. Throws a {@link PlanError} with a discriminated `reason` on every
 * failure path so the caller can render the right affordance.
 */
export async function requestPlan(
  input: RequestPlanInput,
): Promise<PlanIntentResult> {
  const { prompt, deviceId, explain } = input;

  if (!deviceId) {
    throw new PlanError(
      "no-device-id",
      "No paired runner selected — connect a runner to run prompts.",
    );
  }

  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    throw new PlanError("prompt-rejected", "Enter a prompt first.");
  }

  const pageCatalog = buildPageCatalog();

  // Hard client-side deadline. The shared httpClient owns its own AbortController
  // (and overwrites any caller-supplied signal), so we can't hand it one; instead
  // we race the fetch against a timer. On timeout we abort our local controller
  // (best-effort cancellation of any in-flight retry the httpClient is doing) and
  // throw a structured `runner-unreachable` so `run()` reaches the error phase.
  const clientAbort = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof PLAN_TIMEOUT_SENTINEL>((resolve) => {
    timeoutHandle = setTimeout(() => {
      clientAbort.abort();
      resolve(PLAN_TIMEOUT_SENTINEL);
    }, PLAN_CLIENT_TIMEOUT_MS);
  });

  let raced: Response | typeof PLAN_TIMEOUT_SENTINEL;
  try {
    raced = await Promise.race([
      httpClient.fetch(`${ApiConfig.API_BASE_URL}${PLAN_PATH}`, {
        method: "POST",
        // No automatic retries on the planner call. A 502/504/5xx here is a
        // planning failure the user must see immediately — the default 3x 5xx
        // retry would chain multiple 60s request timeouts and present as an
        // indefinite "Planning…" hang (the E2E symptom). Surface it once.
        maxRetries: 0,
        signal: clientAbort.signal,
        headers: {
          [DEVICE_ID_HEADER]: deviceId,
          // Give the relay the full sync window (backend clamps to <=120s) so
          // ~20s+ planning doesn't trip the relay's 30s default → spurious 504.
          [PLAN_TIMEOUT_HEADER]: String(PLAN_RELAY_TIMEOUT_MS),
        },
        // The runner accepts a caller-supplied `pages` list and grounds the plan
        // on it; `pageCatalog` additionally carries the discovered element labels.
        body: JSON.stringify({
          prompt: trimmed,
          explain,
          pageCatalog,
          pages: copilotPages,
        }),
      }),
      timeoutPromise,
    ]);
  } catch (err) {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    // An AbortError (our client deadline, or the httpClient's internal 60s
    // timeout) is a planning timeout, not a generic network failure.
    const name = err instanceof Error ? err.name : "";
    const msg = err instanceof Error ? err.message : "Network error";
    if (name === "AbortError" || /timeout/i.test(msg)) {
      throw new PlanError(
        "runner-unreachable",
        "Planning timed out — the runner took too long. Try again or a simpler prompt.",
      );
    }
    throw new PlanError("planning-failed", `Could not reach the planner: ${msg}`);
  }

  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

  if (raced === PLAN_TIMEOUT_SENTINEL) {
    throw new PlanError(
      "runner-unreachable",
      "Planning timed out — the runner took too long. Try again or a simpler prompt.",
    );
  }

  const response: Response = raced;

  if (!response.ok) {
    const reason = reasonForStatus(response.status);
    const fallback = `Planning failed (HTTP ${response.status}).`;
    const message = await extractErrorMessage(response, fallback);
    throw new PlanError(reason, message, response.status);
  }

  // 200 OK — body is the runner's ApiResponse envelope, relayed verbatim.
  let envelope: RunnerApiResponse;
  try {
    envelope = (await response.json()) as RunnerApiResponse;
  } catch {
    throw new PlanError(
      "malformed-plan",
      "The planner returned a response that could not be parsed as JSON.",
      response.status,
    );
  }

  if (envelope.success !== true) {
    const errMsg =
      typeof envelope.error === "string" && envelope.error.trim().length > 0
        ? envelope.error
        : "The planner reported a failure.";
    throw new PlanError("planning-failed", errMsg, response.status);
  }

  if (!isPlanIntentResult(envelope.data)) {
    throw new PlanError(
      "malformed-plan",
      "The planner returned a plan in an unexpected shape.",
      response.status,
    );
  }

  return envelope.data;
}
