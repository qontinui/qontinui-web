// ============================================================================
// Sessions panel — API client
//
// Thin wrapper around the typed `/operations` client
// (`lib/api/operations/sessionsConsole.ts`), which owns every URL. This file
// maps the client's `<METHOD> <url> failed: <status> - <body>` rejections onto
// the console's own error classes (`SessionsApiError`, `TenantCreateError`,
// `TenantRenameError`) so the text it renders is unchanged, and keeps the
// registered-repo cache and the SSE subscriptions so `page.tsx` stays
// declarative.
//
// All requests are routed through the shared `httpClient` (from
// `@/services/service-factory`) which automatically attaches the
// Bearer token, handles 401-refresh, and adds CSRF headers. SSE
// streams use `httpClient.getAuthToken()` to build auth headers
// manually (httpClient.fetch's internal AbortController would
// conflict with the caller's long-lived signal).
// ============================================================================

import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
  deleteSession,
  fetchConsolidatedSessions,
  fetchRegisteredRepos,
  fetchSession,
  fetchSessionAgentStatus,
  fetchSessionClaims,
  fetchSessionLineage,
  fetchSessionOutput,
  fetchSessionRestoreRecord,
  fetchSessions,
  fetchTenants,
  patchTenant,
  postSessionHandoff,
  postSessionSteal,
  postTenant,
  sessionEventsUrl,
  type GetSessionOutputOptions,
  type HandoffSessionRequest,
  type ListConsolidatedSessionsOptions,
  type ListSessionsOptions,
  type ListSessionsScope,
  type ListSessionsTenantScope,
  type OutputTier,
  type StealSessionRequest,
} from "@/lib/api/operations/sessionsConsole";
import { httpClient } from "@/services/service-factory";
import type { ConsolidatedSessionsResponse } from "./sessionConsoleStatus";
import type {
  AgentStatusResponse,
  LineageResponse,
  OutputChunkFrame,
  OutputHistoryResponse,
  RegisteredRepo,
  SessionClaimsResponse,
  SessionEventRow,
  SessionListResponse,
  SessionRestoreRecordResponse,
  SessionRow,
  TenantCreateRequest,
  TenantCreateResponse,
  TenantListResponse,
  TenantRenameRequest,
  TenantRenameResponse,
} from "./types";

export {
  NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
  type GetSessionOutputOptions,
  type HandoffSessionRequest,
  type ListConsolidatedSessionsOptions,
  type ListSessionsOptions,
  type ListSessionsScope,
  type ListSessionsTenantScope,
  type OutputTier,
  type StealSessionRequest,
};

/**
 * Map a rejection from the typed client onto a `SessionsApiError`. A status
 * rejection (`<METHOD> <url> failed: <status> - <body>`) becomes one whose
 * message stops at the status, as the older helpers here always worded it; the
 * consolidated list keeps the body (`includeBody`), the one shape
 * `console/readFailure.ts::isNotFoundError` can recover a status from.
 * Anything that is not a status rejection (a network error, an abort) is
 * rethrown as it was.
 */
function sessionsApiError(err: unknown, includeBody = false): unknown {
  const status = httpStatusOf(err);
  if (status === null) return err;
  const message = (err as Error).message;
  const head = /^(.+? failed: \d{3})/.exec(message)?.[1] ?? message;
  return new SessionsApiError(includeBody ? message : head, status);
}

export async function listSessions(
  opts: ListSessionsOptions = {}
): Promise<SessionListResponse> {
  return fetchSessions(opts).catch((e: unknown) => {
    throw sessionsApiError(e);
  });
}

/**
 * The consolidated list — `GET /operations/sessions?shape=consolidated`.
 *
 * Plan `2026-08-26-sessions-console-consolidation` D1: ONE list read, joined
 * backend-side across `coord.sessions` and `coord.agent_sessions`, with a
 * first-class `row_class` discriminant per row.
 *
 * There is no session-state `scope` here and that is deliberate: the
 * consolidated shape always reads `scope=all` (the `agent_only` class is a set
 * difference and is only sound over the complete lifecycle set), and `status`
 * is the narrowing the caller actually wants.
 */
export async function listConsolidatedSessions(
  opts: ListConsolidatedSessionsOptions = {}
): Promise<ConsolidatedSessionsResponse> {
  // `<verb> <url> failed: <status> - <body>` — the shape `httpClient` itself
  // formats, and the ONE shape `console/readFailure.ts::isNotFoundError` can
  // recover a status from. The older helpers in this file stop at the status,
  // so a 404 through them is indistinguishable from a dead socket; this path
  // does not inherit that.
  return fetchConsolidatedSessions(opts).catch((e: unknown) => {
    throw sessionsApiError(e, true);
  });
}

export async function getSession(
  id: string,
  signal?: AbortSignal
): Promise<SessionRow> {
  return fetchSession(id, signal).catch((e: unknown) => {
    throw sessionsApiError(e);
  });
}

/**
 * Fetch a session's recorded PTY output for the read-only xterm pane
 * bootstrap window. Plan §Phase 8. Proxies coord's
 * `GET /sessions/:id/output[?tier=warm|cold][&limit=N]` and returns the
 * chunks oldest→newest. The pane writes these to the terminal, then
 * live-tails the `/events` SSE stream and de-dupes by `chunk_offset`.
 *
 * Gated on coord serving the Phase 8 output endpoints (PR #130) — until
 * then this throws a `SessionsApiError` the pane treats as "output not
 * available yet".
 */
export async function getSessionOutput(
  id: string,
  opts: GetSessionOutputOptions = {}
): Promise<OutputHistoryResponse> {
  return fetchSessionOutput(id, opts).catch((e: unknown) => {
    throw sessionsApiError(e);
  });
}

export async function closeSession(id: string): Promise<SessionRow> {
  return deleteSession(id).catch((e: unknown) => {
    throw sessionsApiError(e);
  });
}

/**
 * Take ownership of a session away from the machine currently holding it.
 *
 * **Never retried.** See `NON_IDEMPOTENT_POST_NO_RETRY_STATUSES`. Each attempt
 * records its own coord events, so a retry of an ambiguous 504 writes a second
 * steal into the session's history for one operator click.
 */
export async function stealSession(
  id: string,
  body: StealSessionRequest
): Promise<unknown> {
  return postSessionSteal(id, body).catch((e: unknown) => {
    throw sessionsApiError(e);
  });
}

/**
 * Hand a session off to another machine ("Continue elsewhere"). Plan
 * §Phase 7. POSTs `/sessions/:id/handoff`; coord records the durable
 * `handoff_request` event + publishes the JetStream subject scoped to
 * the target machine. The target runner materializes a child session
 * and closes this one — a one-way move.
 *
 * **Never retried.** See `NON_IDEMPOTENT_POST_NO_RETRY_STATUSES`. A retry of
 * an ambiguous 504 plausibly *succeeds*, so the target runner materializes a
 * second (and third, and fourth) child session from a single "Continue
 * elsewhere" click.
 */
export async function handoffSession(
  id: string,
  body: HandoffSessionRequest
): Promise<unknown> {
  return postSessionHandoff(id, body).catch((e: unknown) => {
    throw sessionsApiError(e);
  });
}

/**
 * Fetch the session's latest `restore-record` (+ `handoff_request`)
 * events — plan `2026-07-09-runner-session-history-cloud-sync` Phase 4.
 * The web backend reduces coord's events replay (SSE) to the two rows
 * the resume UI needs; both fields are null when the session has no
 * such event in coord's 100-row replay window.
 */
export async function getSessionRestoreRecord(
  id: string,
  signal?: AbortSignal
): Promise<SessionRestoreRecordResponse> {
  return fetchSessionRestoreRecord(id, signal).catch((e: unknown) => {
    throw sessionsApiError(e);
  });
}

export async function getSessionClaims(
  sessionId: string,
  signal?: AbortSignal
): Promise<SessionClaimsResponse> {
  return fetchSessionClaims(sessionId, signal).catch((e: unknown) => {
    throw sessionsApiError(e);
  });
}

export async function getSessionAgentStatus(
  sessionId: string,
  signal?: AbortSignal
): Promise<AgentStatusResponse> {
  return fetchSessionAgentStatus(sessionId, signal).catch((e: unknown) => {
    throw sessionsApiError(e);
  });
}

/**
 * Fetch the coord agent-session lineage (worktree/claim/build/merge
 * timeline) for a session. Proxies coord's
 * `GET /coord/agent-sessions/:id/lineage` via the web backend. The
 * same data the admin Coordination Audit dashboard renders, folded
 * into the per-session drill-down.
 */
export async function getSessionLineage(
  sessionId: string,
  signal?: AbortSignal
): Promise<LineageResponse> {
  return fetchSessionLineage(sessionId, signal).catch((e: unknown) => {
    throw sessionsApiError(e);
  });
}

export async function listTenants(
  signal?: AbortSignal
): Promise<TenantListResponse> {
  return fetchTenants(signal).catch((e: unknown) => {
    throw sessionsApiError(e);
  });
}

/**
 * Error from `POST /operations/tenants`, carrying enough for the
 * caller to say something TRUE about what went wrong.
 *
 * The web proxy re-raises coord's status and puts coord's raw response text
 * in FastAPI's `detail`, so the machine-readable reason survives the two
 * hops — but only if we unwrap both layers. `code` is coord's own error
 * token when one was found (`slug_taken`, `invalid_name`, …) and `null`
 * when coord answered something we cannot parse; `detail` is always the
 * most specific human-readable text we could recover, so an unrecognized
 * failure is surfaced verbatim rather than as "something went wrong".
 *
 * `cap`/`created`/`slug` are coord's STRUCTURED operands (see
 * `TenantCreateErrorFields`). Each is `undefined` when coord did not send it
 * or sent a value of the wrong type, so every renderer must have a sentence
 * that works without them — they enrich a message, they never gate one.
 */
export class TenantCreateError extends Error {
  status: number;
  code: string | null;
  detail: string;
  /** Coord's per-operator creation cap (`tenant_cap_reached`). */
  cap?: number;
  /** How many projects the operator has created (`tenant_cap_reached`). */
  created?: number;
  /** The derived slug coord rejected (`slug_taken` / `reserved_name`). */
  slug?: string;
  constructor(
    status: number,
    code: string | null,
    detail: string,
    fields: TenantCreateErrorFields = {}
  ) {
    super(detail || `POST tenants failed: ${status}`);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.cap = fields.cap;
    this.created = fields.created;
    this.slug = fields.slug;
    this.name = "TenantCreateError";
  }
}

/**
 * The structured operands coord puts NEXT TO its error token.
 *
 * Coord's bodies are not `{error, message}` pairs — they carry the numbers and
 * ids the message is about:
 *
 *     {"error":"tenant_cap_reached","cap":5,"created":5}
 *     {"error":"slug_taken","slug":"my-pizzeria"}
 *     {"error":"reserved_name","reason":"group_mapped","slug":"acme"}
 *
 * `parseTenantCreateError` used to read only `error`/`code` and
 * `message`/`detail`/`reason` and threw the rest away, so the cap message
 * could only say "you've reached the limit" — never *what* the limit is, which
 * is the one fact that makes it actionable. Every field is optional and
 * type-checked at the parse boundary: coord owns these bodies, so a missing or
 * renamed field must degrade the sentence, not break the dialog.
 */
export interface TenantCreateErrorFields {
  cap?: number;
  created?: number;
  slug?: string;
}

/**
 * Pull coord's error code + message out of the doubly-wrapped failure body.
 *
 * Two envelopes, because there are two hops:
 *   1. FastAPI's `{ "detail": <x> }` from the web proxy's `HTTPException`;
 *   2. coord's own JSON, which arrives as a STRING inside that `detail`
 *      (`_proxy_coord_post` passes `resp.text`, not `resp.json()`).
 *
 * Every layer is optional: a plain-text body, a non-JSON coord answer, or a
 * FastAPI 422 validation list all degrade to "no code, here is the text".
 * Exported for unit tests — the parsing, not the copy, is where this breaks.
 *
 * Alongside the code and the text it returns coord's structured operands
 * (`TenantCreateErrorFields`) when they are present AND of the right type, so
 * the cap message can name the cap and the collision message can name the id.
 */
export function parseTenantCreateError(rawBody: string): {
  code: string | null;
  detail: string;
} & TenantCreateErrorFields {
  const unwrapped = unwrapProxiedCoordError(rawBody);
  if (unwrapped.kind === "non_string") {
    // A FastAPI 422 validation list, or any object body. No coord code to
    // find; stringify so the operator still sees the real answer.
    return { code: null, detail: unwrapped.text };
  }

  let code: string | null = null;
  let text = unwrapped.text;
  const fields: TenantCreateErrorFields = {};
  // `inner` is null when coord answered plain text — `text` is already it.
  const obj = unwrapped.inner;
  if (obj) {
    const rawCode = obj.error ?? obj.code;
    if (typeof rawCode === "string") code = rawCode;
    const rawMessage = obj.message ?? obj.detail ?? obj.reason;
    if (typeof rawMessage === "string") text = rawMessage;
    else if (code) text = code;
    // The structured operands. Type-checked one at a time and dropped
    // individually — coord sending `cap` but not `created` (or a future
    // coord sending a string where a number was) must cost the numbers in
    // one sentence, never the whole parse.
    if (typeof obj.cap === "number" && Number.isFinite(obj.cap)) {
      fields.cap = obj.cap;
    }
    if (typeof obj.created === "number" && Number.isFinite(obj.created)) {
      fields.created = obj.created;
    }
    if (typeof obj.slug === "string" && obj.slug !== "") {
      fields.slug = obj.slug;
    }
  }
  return { code, detail: text, ...fields };
}

/**
 * The two-layer unwrap shared by every tenant write's error parser.
 *
 * Two envelopes, because there are two hops:
 *   1. the web proxy's `HTTPException`, in EITHER of its two shapes:
 *      - FastAPI's bare `{ "detail": <x> }` (what a router mounted without
 *        the app's handlers — every unit test — returns), or
 *      - the app's standardized envelope `{ "error": <STATUS_CODE_NAME>,
 *        "message": <x>, "timestamp", "path" }`, which is what production
 *        serves: `app/main.py` registers `http_exception_handler` for every
 *        route, and it moves a string `detail` into `message`. Reading only
 *        `detail` would take the envelope's generic status token for coord's
 *        code and never reach coord's body;
 *   2. coord's own JSON, which arrives as a STRING inside that layer
 *      (the proxies pass `resp.text`, not `resp.json()`).
 *
 * `kind: "non_string"` is a detail that was not a string at all (a FastAPI 422
 * validation list) — `text` is its JSON. Otherwise `text` is the detail string
 * and `inner` is coord's parsed object when that string was a JSON object.
 */
function unwrapProxiedCoordError(rawBody: string):
  | { kind: "non_string"; text: string; envelopeCode: string | null }
  | {
      kind: "string";
      text: string;
      inner: Record<string, unknown> | null;
      envelopeCode: string | null;
    } {
  let detail: unknown = rawBody;
  // The production envelope's own status token (`CONFLICT`, `BAD_GATEWAY`).
  // Kept apart from coord's code on purpose: it is a fallback label for the
  // STATUS, and reporting it as coord's code would claim coord said it.
  let envelopeCode: string | null = null;
  try {
    const outer: unknown = JSON.parse(rawBody);
    if (outer && typeof outer === "object" && "detail" in outer) {
      detail = (outer as { detail: unknown }).detail;
    } else if (outer && typeof outer === "object") {
      const envelope = outer as Record<string, unknown>;
      // The production envelope — see above. `path` is what distinguishes it
      // from coord's own `{error, message}` body arriving unwrapped.
      if (
        "error" in envelope &&
        "path" in envelope &&
        typeof envelope.message === "string"
      ) {
        detail = envelope.message;
        if (typeof envelope.error === "string" && envelope.error !== "") {
          envelopeCode = envelope.error;
        }
      }
    }
  } catch {
    // Not JSON at all — keep the raw text.
  }
  if (typeof detail !== "string") {
    return { kind: "non_string", text: JSON.stringify(detail), envelopeCode };
  }
  let inner: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (parsed && typeof parsed === "object") {
      inner = parsed as Record<string, unknown>;
    }
  } catch {
    // coord answered plain text.
  }
  return { kind: "string", text: detail, inner, envelopeCode };
}

/**
 * Error from `PATCH /operations/tenants/{tenant_id}`.
 *
 * `code` is coord's error token (`invalid_slug`, `reserved_name`,
 * `slug_pinned`, `slug_taken`, `tenant_mismatch`, …) or `null` when none could
 * be recovered. `reason` is coord's SECOND-level discriminator, carried
 * separately rather than folded into `detail`, because three of the rename's
 * codes mean nothing actionable without it (`invalid_slug` → which rule,
 * `reserved_name` → which list, `slug_pinned` → which pin). `detail` is the
 * most specific human-readable text recovered, for the verbatim fallback.
 */
export class TenantRenameError extends Error {
  status: number;
  code: string | null;
  reason: string | null;
  detail: string;
  /** The slug coord named, when it named one (`slug_taken`). */
  slug?: string;
  /** The production error envelope's status token (`BAD_GATEWAY`, …), when
   *  the body came through it — the fallback label when coord sent no code. */
  envelopeCode: string | null;
  constructor(
    status: number,
    code: string | null,
    reason: string | null,
    detail: string,
    slug?: string,
    envelopeCode: string | null = null
  ) {
    super(detail || `PATCH tenant failed: ${status}`);
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.detail = detail;
    this.slug = slug;
    this.envelopeCode = envelopeCode;
    this.name = "TenantRenameError";
  }
}

/**
 * Parse a rename failure body: `parseTenantCreateError`'s code/detail/slug
 * (the same two-layer unwrap), plus coord's `reason` when it sent a string
 * one. Exported for unit tests.
 */
export function parseTenantRenameError(rawBody: string): {
  code: string | null;
  reason: string | null;
  detail: string;
  slug?: string;
  envelopeCode: string | null;
} {
  const { code, detail, slug } = parseTenantCreateError(rawBody);
  const unwrapped = unwrapProxiedCoordError(rawBody);
  const rawReason =
    unwrapped.kind === "string" ? unwrapped.inner?.reason : undefined;
  const reason =
    typeof rawReason === "string" && rawReason !== "" ? rawReason : null;
  return { code, reason, detail, slug, envelopeCode: unwrapped.envelopeCode };
}

/**
 * Create a new tenant ("Project") owned by the calling operator.
 *
 * POSTs `/operations/tenants`, which proxies coord's
 * `POST /coord/tenants` (plan
 * `2026-08-25-self-service-tenant-project-creation`). Coord creates the
 * tenant, seeds its policy row and grants the caller `admin` in it in ONE
 * transaction, so the membership is readable on the very next
 * `GET /operations/tenants`.
 *
 * **Never retried.** See `NON_IDEMPOTENT_POST_NO_RETRY_STATUSES`.
 */
export async function createTenant(
  body: TenantCreateRequest
): Promise<TenantCreateResponse> {
  return postTenant(body).catch((e: unknown) => {
    const status = httpStatusOf(e);
    if (status === null) throw e;
    const { code, detail, ...fields } = parseTenantCreateError(
      httpBodyOf(e) ?? ""
    );
    throw new TenantCreateError(status, code, detail, fields);
  });
}

/**
 * Rename a tenant ("Project") — its display name, its slug, or both.
 *
 * PATCHes `/operations/tenants/{tenant_id}`, which proxies coord's
 * `PATCH /coord/tenants/:tenant_id` (plan `2026-09-17-tenant-rename`). Send
 * only the fields that changed. Coord allows it only for an `admin` of that
 * tenant; the web proxy sets the active-tenant header to the path tenant.
 *
 * **Never retried**, for the same reason as `createTenant`: a rename that
 * committed at 5.1s answers 504, and a retry is then judged against the NEW
 * slug — a no-op at best, a false failure the operator acts on at worst.
 */
export async function renameTenant(
  tenantId: string,
  body: TenantRenameRequest
): Promise<TenantRenameResponse> {
  return patchTenant(tenantId, body).catch((e: unknown) => {
    const status = httpStatusOf(e);
    if (status === null) throw e;
    const { code, reason, detail, slug, envelopeCode } = parseTenantRenameError(
      httpBodyOf(e) ?? ""
    );
    throw new TenantRenameError(
      status,
      code,
      reason,
      detail,
      slug,
      envelopeCode
    );
  });
}

// ---- Registered repos (module-level cache) --------------------------------

let _repoCache: { repos: RegisteredRepo[]; fetchedAt: number } | null = null;
let _repoInflight: Promise<RegisteredRepo[]> | null = null;
const REPO_CACHE_TTL_MS = 30_000;

export async function listRegisteredRepos(
  signal?: AbortSignal
): Promise<RegisteredRepo[]> {
  if (_repoCache && Date.now() - _repoCache.fetchedAt < REPO_CACHE_TTL_MS) {
    return _repoCache.repos;
  }
  if (_repoInflight) return _repoInflight;

  _repoInflight = (async () => {
    try {
      const data = await fetchRegisteredRepos(signal).catch((e: unknown) => {
        throw sessionsApiError(e);
      });
      const repos = data.repos ?? [];
      _repoCache = { repos, fetchedAt: Date.now() };
      return repos;
    } finally {
      _repoInflight = null;
    }
  })();

  return _repoInflight;
}

export function registeredRepoSlugs(repos: RegisteredRepo[]): Set<string> {
  return new Set(repos.map((r) => r.repo));
}

export function findRegisteredRepo(
  repos: RegisteredRepo[],
  slug: string
): RegisteredRepo | undefined {
  return repos.find((r) => r.repo === slug);
}

// ---- SSE subscription ---------------------------------------------------

/**
 * Subscribe to the per-session event stream. Returns an
 * `EventSource`-like cleanup function. The browser's native
 * `EventSource` constructor doesn't carry credentials by default;
 * we instead consume the proxy's chunked HTTP body via `fetch` +
 * a manual SSE-frame parser. This is the same shape that
 * `qontinui-runner` uses for its own dashboards and matches the
 * behavior of `coord`'s SSE route (replay-then-live-tail).
 *
 * Caller receives:
 *   - `onEvent(row)` for every event row parsed
 *   - `onError(err)` for transport/parse errors
 *   - `onClose()` when the upstream closes cleanly
 *
 * The returned function cancels the underlying fetch.
 */
export interface SessionEventStreamHandlers {
  onEvent: (event: SessionEventRow) => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
}

export function subscribeSessionEvents(
  sessionId: string,
  handlers: SessionEventStreamHandlers
): () => void {
  const controller = new AbortController();
  const url = sessionEventsUrl(sessionId);

  void (async () => {
    try {
      // Build auth headers manually — httpClient.fetch() has its own
      // internal AbortController which would conflict with the
      // caller's long-lived SSE signal.
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
      };
      const token = httpClient.getAuthToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers,
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new SessionsApiError(
          `GET ${url} failed: ${res.status}`,
          res.status
        );
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE frames separated by blank line. Split eagerly so we
        // surface each complete frame ASAP.
        while (true) {
          const sep = buf.indexOf("\n\n");
          if (sep === -1) break;
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          parseFrame(frame, handlers);
        }
      }
      handlers.onClose?.();
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      handlers.onError?.(err);
    }
  })();

  return () => controller.abort();
}

function parseFrame(frame: string, handlers: SessionEventStreamHandlers): void {
  // Each frame is a sequence of `field: value` lines. We only care
  // about `data:` lines; per the SSE spec, multiple `data:` lines in
  // one frame concatenate with `\n` joins.
  const lines = frame.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return;
  const payload = dataLines.join("\n");
  let parsed: SessionEventRow;
  try {
    parsed = JSON.parse(payload) as SessionEventRow;
  } catch (err) {
    handlers.onError?.(
      new Error(
        `failed to parse SSE frame: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    return;
  }
  dispatchToHandler(() => handlers.onEvent(parsed), handlers.onError);
}

/**
 * Invoke a subscriber handler, isolating its exceptions from the SSE
 * reader loop: a throwing handler must not terminate the stream. Errors
 * route to the subscriber's non-fatal `onError` channel — except
 * `AbortError`, whose silent-cancellation semantics are preserved.
 */
function dispatchToHandler(
  invoke: () => void,
  onError: ((err: unknown) => void) | undefined
): void {
  try {
    invoke();
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") return;
    onError?.(err);
  }
}

// ---- SSE subscription: output chunks ------------------------------------

/**
 * Subscribe to a session's live PTY output. Plan §Phase 8.
 *
 * Consumes the SAME `/sessions/:id/events` SSE endpoint as
 * {@link subscribeSessionEvents}, but parses each frame's JSON for the
 * `output_chunk` shape (`{ event_kind: "output_chunk", chunk_offset,
 * payload_b64, ... }`) rather than the `SessionEventRow` shape. Output
 * chunks live in `coord.session_output` (not `coord.session_events`), so
 * they only ever arrive as `event: live` frames — never in the event
 * replay. Frames that aren't output chunks (started/heartbeat/closed/…)
 * are ignored here; the events timeline consumes those via
 * `subscribeSessionEvents`.
 *
 * The pane opens this in parallel with the history fetch and de-dupes by
 * `chunk_offset`, so a chunk that lands in both the warm bootstrap and
 * the live tail is written once.
 *
 * Returns a cleanup function that cancels the underlying fetch.
 */
export interface SessionOutputStreamHandlers {
  onChunk: (chunk: OutputChunkFrame) => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
}

export function subscribeSessionOutput(
  sessionId: string,
  handlers: SessionOutputStreamHandlers
): () => void {
  const controller = new AbortController();
  const url = sessionEventsUrl(sessionId);

  void (async () => {
    try {
      // Build auth headers manually — same rationale as
      // subscribeSessionEvents (long-lived SSE, own AbortController).
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
      };
      const token = httpClient.getAuthToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers,
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new SessionsApiError(
          `GET ${url} failed: ${res.status}`,
          res.status
        );
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        while (true) {
          const sep = buf.indexOf("\n\n");
          if (sep === -1) break;
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          parseOutputFrame(frame, handlers);
        }
      }
      handlers.onClose?.();
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      handlers.onError?.(err);
    }
  })();

  return () => controller.abort();
}

function parseOutputFrame(
  frame: string,
  handlers: SessionOutputStreamHandlers
): void {
  const lines = frame.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return;
  const payload = dataLines.join("\n");
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    // A non-JSON frame (keep-alive comment, etc.) — ignore silently.
    return;
  }
  if (isOutputChunkFrame(parsed)) {
    // Isolated so a chunk-handler exception can't kill the reader loop.
    dispatchToHandler(() => handlers.onChunk(parsed), handlers.onError);
  }
  // Non-output frames (started/heartbeat/closed/claim_stolen/…) are not
  // this subscriber's concern.
}

function isOutputChunkFrame(value: unknown): value is OutputChunkFrame {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.event_kind === "output_chunk" &&
    typeof rec.chunk_offset === "number" &&
    typeof rec.payload_b64 === "string"
  );
}

export class SessionsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "SessionsApiError";
  }
}
