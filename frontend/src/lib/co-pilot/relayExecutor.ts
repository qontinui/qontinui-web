/**
 * relayExecutor.ts
 *
 * Phase 3 of the web co-pilot: dispatch a single planned step against the
 * user's OWN browser tab over the UI-Bridge relay.
 *
 * Transport: the same-origin catch-all relay route
 * (`src/app/api/ui-bridge/[...path]/route.ts`). Commands are routed to a
 * registered browser tab by `targetTabId` in the POST body — the SDK's
 * relay route handler injects `body.tabId = <query|header>` when present and
 * otherwise reads `targetTabId`/`tabId` straight from the body (see
 * `node_modules/@qontinui/ui-bridge/dist/server/nextjs.js` ~L24892-24911).
 *
 * The tab id is the value the SDK's `CommandRelayListener` registered itself
 * under: a per-tab UUID persisted in `sessionStorage["__uiBridge_tabId"]`
 * (SDK `resolveTabId()`, react/index.js ~L32722). Because the co-pilot page
 * IS that tab, reading the same key yields the id of the tab we want to drive.
 *
 * Step → route:
 *   - navigate → resolve `target` page id to a URL via `pageIdToUrl`, then
 *     `POST /api/ui-bridge/control/page/navigate {url, mode:"soft", targetTabId}`.
 *   - action   → `POST /api/ui-bridge/ai/execute {instruction, targetTabId}`,
 *     unless the instruction is a direct `<verb> element <id>` form, which
 *     short-circuits to `POST /api/ui-bridge/control/element/:id/action`.
 *
 * Pure helpers — no React. The hook owns sequencing and abort.
 */

import { httpClient } from "@/services/service-factory";
import type { PlanStep } from "./planClient";
import { pageIdToUrl } from "./pageMap";

/** Base path of the same-origin relay route. */
const RELAY_BASE = "/api/ui-bridge";

/**
 * Read this tab's UI-Bridge tab id. Mirrors the SDK's `resolveTabId()`:
 * the value lives in `sessionStorage["__uiBridge_tabId"]`. Returns null when
 * the bridge listener hasn't registered yet (no id minted) or off-DOM (SSR).
 */
export function getCurrentTabId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem("__uiBridge_tabId");
  } catch {
    return null;
  }
}

/** Per-step dispatch outcome. `ok:false` always carries a human-readable reason. */
export type StepResult =
  | { ok: true; detail: string }
  | { ok: false; reason: string; status?: number };

/**
 * The relay route's response envelope. The outer shape is the SDK's
 * `{success, data?, error?, code?, timestamp}` (server/nextjs.js `success`/
 * `error` helpers). For `/ai/execute`, `data` is the NLActionExecutor result
 * which itself carries a nested `success`/`error`.
 */
interface RelayEnvelope {
  success?: unknown;
  data?: unknown;
  error?: unknown;
  code?: unknown;
}

/** Nested NL/action result inside a successful `/ai/execute` or element-action envelope. */
interface NestedActionResult {
  success?: unknown;
  error?: unknown;
  errorCode?: unknown;
}

/**
 * Parsed direct-id instruction. When non-null, the executor dispatches to
 * `/control/element/:id/action` instead of the NL `/ai/execute` path.
 * Mirrors the runner hook's `parseDirectIdInstruction` verb set.
 */
interface DirectIdInstruction {
  targetId: string;
  action: "click" | "check" | "uncheck" | "type";
  params?: Record<string, unknown>;
}

/**
 * Parse `<verb> element <id>` (and `type "<text>" in element <id>`) forms.
 * Returns null for free-text instructions (those use the NL pipeline).
 */
function parseDirectIdInstruction(
  instruction: string,
): DirectIdInstruction | null {
  const trimmed = instruction.trim();

  const verbMatch = trimmed.match(/^(click|check|uncheck) element ([\w-]+)$/i);
  if (verbMatch) {
    const action = verbMatch[1]!.toLowerCase() as "click" | "check" | "uncheck";
    return { targetId: verbMatch[2]!, action };
  }

  const typeMatch = trimmed.match(
    /^type ['"]([^'"]+)['"] in element ([\w-]+)$/i,
  );
  if (typeMatch) {
    return {
      targetId: typeMatch[2]!,
      action: "type",
      params: { text: typeMatch[1]!, clear: true },
    };
  }

  return null;
}

/**
 * POST to a relay route and return the parsed envelope plus HTTP status.
 * Uses `httpClient.fetch` so the session bearer + credentials ride along when
 * the relay's auth gate (`UI_BRIDGE_REQUIRE_AUTH=1`) is enabled.
 */
async function relayPost(
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; ok: boolean; envelope: RelayEnvelope | null }> {
  const response = await httpClient.fetch(`${RELAY_BASE}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  let envelope: RelayEnvelope | null = null;
  try {
    envelope = (await response.json()) as RelayEnvelope;
  } catch {
    envelope = null;
  }
  return { status: response.status, ok: response.ok, envelope };
}

/** Turn a relay transport/HTTP failure into a human-readable reason. */
function transportReason(
  status: number,
  envelope: RelayEnvelope | null,
): string {
  const code =
    envelope && typeof envelope.code === "string" ? envelope.code : null;
  const err =
    envelope && typeof envelope.error === "string" ? envelope.error : null;
  if (status === 429) {
    return "rate limited — too many co-pilot commands; wait a moment and retry";
  }
  if (status === 401 || status === 403) {
    return "not authorized to drive this tab (sign-in may have expired)";
  }
  if (code === "NO_BROWSER_CONNECTED" || status === 503) {
    return "no browser tab is connected to the relay — the co-pilot must be enabled and consented in this tab";
  }
  if (err) return err;
  return `relay returned HTTP ${status}`;
}

/**
 * Dispatch a `navigate` step: resolve the page id to a URL and soft-navigate
 * the target tab. Returns a specific error when the page id can't be resolved
 * (never a silent no-op).
 */
async function dispatchNavigate(
  step: PlanStep,
  targetTabId: string,
): Promise<StepResult> {
  if (!step.target) {
    return { ok: false, reason: "navigate step is missing a target page id" };
  }
  const url = pageIdToUrl(step.target);
  if (url === undefined) {
    return {
      ok: false,
      reason: `unknown page id "${step.target}" — not a navigable co-pilot page`,
    };
  }

  // `mode: "soft"` does a client-side history navigation (pushState +
  // popstate) so the SPA route changes without a full reload that would tear
  // down the bridge listener and the running plan.
  const { status, ok, envelope } = await relayPost("/control/page/navigate", {
    url,
    mode: "soft",
    targetTabId,
  });

  if (!ok || envelope?.success !== true) {
    return {
      ok: false,
      reason: transportReason(status, envelope),
      status,
    };
  }
  return { ok: true, detail: `navigated to ${url}` };
}

/**
 * Dispatch an `action` step. Direct `<verb> element <id>` instructions go to
 * `/control/element/:id/action`; everything else uses the NL `/ai/execute`
 * path. The per-step effect check inspects BOTH the outer relay envelope and
 * the nested action result's `success`/`error`.
 */
async function dispatchAction(
  step: PlanStep,
  targetTabId: string,
): Promise<StepResult> {
  const instruction = step.instruction;
  if (!instruction) {
    return { ok: false, reason: "action step is missing an instruction" };
  }

  const direct = parseDirectIdInstruction(instruction);

  const { status, ok, envelope } = direct
    ? await relayPost(
        `/control/element/${encodeURIComponent(direct.targetId)}/action`,
        {
          action: direct.action,
          ...(direct.params ? { params: direct.params } : {}),
          waitOptions: { visible: true, enabled: true, timeout: 5000 },
          targetTabId,
        },
      )
    : await relayPost("/ai/execute", { instruction, targetTabId });

  // Transport / HTTP-level failure.
  if (!ok || envelope?.success !== true) {
    return {
      ok: false,
      reason: transportReason(status, envelope),
      status,
    };
  }

  // Observable-effect check: the action handler nests its own success flag
  // under `data`. A relay 200 with `data.success === false` is a real action
  // failure (element not found, timeout, low confidence), not a no-op.
  const nested = envelope.data as NestedActionResult | null | undefined;
  if (nested && typeof nested === "object" && nested.success === false) {
    const detail =
      (typeof nested.error === "string" && nested.error) ||
      (typeof nested.errorCode === "string" && nested.errorCode) ||
      "action did not complete";
    return {
      ok: false,
      reason: `could not ${instruction} — ${detail}`,
      status,
    };
  }

  return {
    ok: true,
    detail: direct
      ? `${direct.action} element ${direct.targetId}`
      : instruction,
  };
}

/**
 * Dispatch a single plan step against `targetTabId`. Pure: no retries, no
 * settle delay (the hook owns inter-step pacing). Always returns a structured
 * result — never throws for an expected relay/validation failure.
 */
export async function dispatchStep(
  step: PlanStep,
  targetTabId: string,
): Promise<StepResult> {
  try {
    if (step.type === "navigate") {
      return await dispatchNavigate(step, targetTabId);
    }
    return await dispatchAction(step, targetTabId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unexpected dispatch error";
    return { ok: false, reason: msg };
  }
}
