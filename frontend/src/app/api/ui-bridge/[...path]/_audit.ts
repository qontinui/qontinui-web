/**
 * UI Bridge write-command audit log (§4.8 of the production-safe plan).
 *
 * Two responsibilities, both intentionally small:
 *
 *   1. `isAuditablePath` — decide whether a given (path, method) is a
 *      write-command worthy of an audit row. Reads (GET) and SDK
 *      transport endpoints (`/heartbeat`, `/commands`, `/commands/stream`,
 *      `/render-log/*`) are NEVER audited; the goal is to record commands
 *      issued on the user's behalf, not a request log.
 *
 *   2. `summarizeBody` — extract a SAFE summary from a parsed request body.
 *      Allowed: `{action: "click", elementId: "btn-42"}`. Allowed:
 *      `{action: "type", elementId: "input-3", textLength: 8}`. NEVER the
 *      raw text that was typed (could be a password the redaction layer
 *      missed). The middleware logs the FACT, not the secret.
 *
 *   3. `recordAudit` — server-to-server POST into the FastAPI backend's
 *      `/api/v1/users/me/co-pilot/activity` insert endpoint. Fire-and-
 *      forget: failures are logged and swallowed; the relay response
 *      MUST NOT be blocked by audit-log durability.
 *
 * The route handler calls all three in sequence: `isAuditablePath` decides
 * IF, `summarizeBody` shapes the safe summary, the handler runs, then
 * `recordAudit` records the row with the final status code.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.8.
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("UIBridgeAudit");

/* -------------------------------------------------------------------- */
/* Path classification                                                  */
/* -------------------------------------------------------------------- */

/**
 * Path prefixes whose POST/PUT/DELETE constitutes a co-pilot write command
 * (state-changing call into the browser). A path matches if it begins
 * with one of these AND the method is non-GET.
 *
 * The two namespaces are `/control/*` (direct element/page manipulation,
 * batch fan-out, navigation) and `/ai/*` (LLM-driven find / wait — these
 * are reads in spirit but write to the relay's request stream, so they
 * count as user-attributable actions worth auditing).
 *
 * Order in this list is intentional: the explicit `/control/render-log/`
 * GET-only namespace is excluded by the GET filter, but we also exclude
 * any non-GET writes under it via `NON_AUDITABLE_PREFIXES` below, since
 * render-log is dev-debug telemetry that isn't a user-issued command.
 */
const AUDITABLE_PREFIXES: readonly string[] = ["/control/", "/ai/"];

/**
 * Namespaces under `AUDITABLE_PREFIXES` that look like writes by HTTP
 * method but aren't co-pilot commands. Currently just render-log
 * (debug telemetry the renderer pushes to the relay).
 */
const NON_AUDITABLE_PREFIXES: readonly string[] = ["/control/render-log/"];

/**
 * Transport endpoints the SDK uses for its own bookkeeping (heartbeats,
 * command-stream multiplexing, response delivery). These can be
 * extremely high-volume in normal operation and never represent a user
 * command; auditing them would flood the table and obscure the signal.
 */
const TRANSPORT_NON_AUDIT_EXACT: ReadonlySet<string> = new Set([
  "/heartbeat",
  "/commands",
  "/commands/stream",
]);

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * True when `(path, method)` is a UI Bridge write command worth auditing.
 *
 * Decision tree:
 *   1. GET / PATCH (and any non-POST/PUT/DELETE)         → no audit (reads / unused).
 *   2. Exact transport endpoint (`/heartbeat` etc.)      → no audit.
 *   3. Path under a `NON_AUDITABLE_PREFIXES` namespace    → no audit.
 *   4. Path under an `AUDITABLE_PREFIXES` namespace      → AUDIT.
 *   5. Anything else                                     → no audit (unknown
 *      namespace — the SDK 404 path handles those; we don't want to
 *      audit something we don't recognize).
 */
export function isAuditablePath(path: string, method: HttpMethod): boolean {
  if (method !== "POST" && method !== "PUT" && method !== "DELETE") {
    return false;
  }
  if (TRANSPORT_NON_AUDIT_EXACT.has(path)) {
    return false;
  }
  for (const ns of NON_AUDITABLE_PREFIXES) {
    if (path.startsWith(ns)) return false;
  }
  for (const ns of AUDITABLE_PREFIXES) {
    if (path.startsWith(ns)) return true;
  }
  return false;
}

/* -------------------------------------------------------------------- */
/* Canonical command name                                               */
/* -------------------------------------------------------------------- */

/**
 * Map a relay path to a canonical command name for the audit row.
 *
 * Examples (the patterns we currently care about):
 *   `/control/element/btn-1/action`        → `element.action`
 *   `/control/page/navigate`               → `page.navigate`
 *   `/control/batch-execute`               → `batch.execute`
 *   `/control/batch-actions`               → `batch.actions`
 *   `/control/batch`                       → `batch`
 *   `/ai/find`                             → `ai.find`
 *   `/ai/wait-for-element`                 → `ai.wait-for-element`
 *
 * Unknown paths fall back to the path with leading slash stripped — the
 * goal is a useful filter dimension for the activity viewer, not a
 * lossless encoding.
 */
export function commandNameFromPath(path: string): string {
  // `/control/element/<id>/action`
  const elementAction = /^\/control\/element\/[^/]+\/action$/.exec(path);
  if (elementAction) return "element.action";

  // `/control/page/<verb>` — `/control/page/navigate` etc.
  const pageVerb = /^\/control\/page\/([^/]+)$/.exec(path);
  if (pageVerb) return `page.${pageVerb[1]}`;

  // `/control/batch-execute`, `/control/batch-actions`, `/control/batch`
  if (path === "/control/batch-execute") return "batch.execute";
  if (path === "/control/batch-actions") return "batch.actions";
  if (path === "/control/batch") return "batch";

  // `/ai/<verb>`
  const aiVerb = /^\/ai\/(.+)$/.exec(path);
  if (aiVerb) return `ai.${aiVerb[1]}`;

  // Fallback: best-effort flat name. Drop leading slash, collapse the rest.
  return path.replace(/^\//, "").replace(/\//g, ".");
}

/* -------------------------------------------------------------------- */
/* Safe body summary                                                    */
/* -------------------------------------------------------------------- */

interface BodyShapeShallow {
  action?: unknown;
  elementId?: unknown;
  selector?: unknown;
  text?: unknown;
  description?: unknown;
  url?: unknown;
  actions?: unknown;
  commands?: unknown;
  steps?: unknown;
}

/**
 * Extract a SAFE summary of a parsed request body for audit storage.
 *
 * The function knows about a fixed set of fields (action / elementId /
 * selector / url / batch length) and copies ONLY those — never the raw
 * `text` from a type command, never a description that might embed
 * user input, never a free-form payload. Anything not in the allow-list
 * is dropped.
 *
 * `text` is read ONLY to compute `textLength` (a non-leaky scalar) and
 * is then dropped before the object is returned.
 *
 * Returns `null` when the body has no recognizable safe fields — the
 * audit row records the command and status without a summary in that
 * case. We never invent a summary; better an empty cell than a leak.
 */
export function summarizeBody(
  body: unknown,
  commandName: string,
): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const b = body as BodyShapeShallow;

  const summary: Record<string, unknown> = { action: commandName };

  // String fields that are safe to record verbatim (these are identifiers
  // / selectors / URLs the user already saw in their devtools — they are
  // not user-typed secrets). They MUST be capped to a reasonable length
  // so a malicious caller can't blow out the JSONB column with a
  // megabyte selector.
  const safeStr = (v: unknown, max: number): string | undefined => {
    if (typeof v !== "string") return undefined;
    return v.length > max ? `${v.slice(0, max)}…` : v;
  };

  const elementId = safeStr(b.elementId, 256);
  if (elementId) summary.elementId = elementId;

  const selector = safeStr(b.selector, 256);
  if (selector) summary.selector = selector;

  const url = safeStr(b.url, 256);
  if (url) summary.url = url;

  // For action payloads, `action` on the body is the verb (click / type / etc.).
  // Record it under a separate key so we keep the canonical commandName
  // in `action` and don't lose the body's own action verb.
  if (typeof b.action === "string") {
    summary.bodyAction = safeStr(b.action, 64);
  }

  // `text` from a TYPE action: NEVER store the text, ONLY its length.
  // The text could be a password the redaction layer missed.
  if (typeof b.text === "string") {
    summary.textLength = b.text.length;
  }

  // Batch endpoints: record the count, not the payload.
  if (Array.isArray(b.actions)) summary.batchSize = b.actions.length;
  else if (Array.isArray(b.commands)) summary.batchSize = b.commands.length;
  else if (Array.isArray(b.steps)) summary.batchSize = b.steps.length;

  // If we only have the `action` (commandName) and nothing else, treat
  // that as "no useful summary": store nothing rather than a stub row.
  const keys = Object.keys(summary);
  if (keys.length === 1 && keys[0] === "action") {
    return null;
  }
  return summary;
}

/* -------------------------------------------------------------------- */
/* Server-to-server insert                                              */
/* -------------------------------------------------------------------- */

/**
 * Backend base URL. Mirrors `_auth.ts::backendBaseUrl` — see that module
 * for the rationale (must be set directly here so the gate works in
 * environments without the `/api/:path*` rewrite).
 */
function backendBaseUrl(): string {
  return (
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000"
  );
}

export interface AuditInsertInput {
  /** Caller's Bearer (same one the auth gate just verified). */
  token: string;
  sessionId: string | null;
  tabId: string | null;
  commandName: string;
  targetElementId: string | null;
  path: string;
  method: string;
  origin: string | null;
  statusCode: number;
  payloadSummary: Record<string, unknown> | null;
}

/**
 * Insert an audit row. Fire-and-forget by contract — callers should NOT
 * await this in a path that affects the user-visible response.
 *
 * A failed insert MUST NOT bubble up to the caller; it's logged at
 * warn-level so an operator can detect a backend outage but the relay
 * remains functional. The function itself is async (it returns a
 * promise the caller may attach an unhandled-rejection guard to via
 * `.catch`).
 */
export async function recordAudit(input: AuditInsertInput): Promise<void> {
  try {
    const base = backendBaseUrl();
    const resp = await fetch(`${base}/api/v1/users/me/co-pilot/activity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({
        session_id: input.sessionId,
        tab_id: input.tabId,
        command_name: input.commandName,
        target_element_id: input.targetElementId,
        path: input.path,
        method: input.method,
        origin: input.origin,
        status_code: input.statusCode,
        payload_summary: input.payloadSummary,
      }),
    });
    if (!resp.ok) {
      log.warn("audit_insert_non_ok", {
        status: resp.status,
        commandName: input.commandName,
        path: input.path,
      });
    }
  } catch (err) {
    log.warn("audit_insert_failed", {
      error: err instanceof Error ? err.message : String(err),
      commandName: input.commandName,
      path: input.path,
    });
  }
}

/* -------------------------------------------------------------------- */
/* Target-element extraction                                            */
/* -------------------------------------------------------------------- */

/**
 * Pull the targeted element id out of either the path (e.g.
 * `/control/element/btn-1/action`) or the body's `elementId` field
 * (e.g. `/ai/find` / `/control/batch-actions`). Returns null when the
 * command isn't element-targeted.
 *
 * Capped at 256 chars so a malicious caller can't bloat the column.
 */
export function targetElementIdFor(
  path: string,
  body: unknown,
): string | null {
  const elementAction = /^\/control\/element\/([^/]+)\/action$/.exec(path);
  if (elementAction) {
    const id = elementAction[1];
    if (id) {
      return id.length > 256 ? id.slice(0, 256) : id;
    }
  }
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const v = (body as { elementId?: unknown }).elementId;
    if (typeof v === "string") {
      return v.length > 256 ? v.slice(0, 256) : v;
    }
  }
  return null;
}

/* -------------------------------------------------------------------- */
/* Tab id extraction                                                    */
/* -------------------------------------------------------------------- */

/**
 * Read the SDK's per-tab id from either the body (`targetTabId`) or
 * the `X-Caller-Tab-Id` request header (SDK ≥ 0.12.0 mirrors the value
 * onto a header so server middleware can read it without parsing the body).
 * Returns null when neither carries a string value.
 */
export function tabIdFor(
  bodyPeek: unknown,
  headerValue: string | null,
): string | null {
  if (headerValue && headerValue.length <= 128) return headerValue;
  if (bodyPeek && typeof bodyPeek === "object" && !Array.isArray(bodyPeek)) {
    const v = (bodyPeek as { targetTabId?: unknown }).targetTabId;
    if (typeof v === "string" && v.length <= 128) return v;
  }
  return null;
}
