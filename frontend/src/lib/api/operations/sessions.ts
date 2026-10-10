/**
 * `/operations/sessions*` — the session-lifecycle proxy: the session list
 * (plain and consolidated), one session, its output, its restore record,
 * claims, agent status and lineage, the steal / handoff / close writes, and
 * the two SSE readers over `/sessions/{id}/events`.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D5, Phase 7 batch 1). MOVED here from `components/sessions/api.ts` together
 * with `tenants.ts` (the tenant and registered-repo routes that file also
 * carried). The behaviour is that file's, with two changes: the base is the
 * RELATIVE `OPERATIONS_BASE` (D6 — a transport change from the absolute
 * `OPERATIONS_BASE`, for the SSE readers too), and every call states its retry
 * policy (`idempotent`).
 *
 * All request/response calls go through the shared `httpClient`, which
 * attaches the Bearer token, handles 401-refresh, and adds CSRF headers. The
 * SSE streams keep their own streaming `fetch` and build the auth header from
 * `httpClient.getAuthToken()` themselves (httpClient.fetch's internal
 * AbortController would conflict with the caller's long-lived signal) — that
 * transport is unchanged by the move.
 *
 * Errors stay the typed {@link SessionsApiError} (status-carrying) rather
 * than `readJson`'s shape: `LiveTailPane`, `ResumePanel`, `TranscriptPane` and
 * `sessionKeyResolution` branch on `instanceof SessionsApiError` + `status`.
 *
 * The wire types live in `components/sessions/types.ts` and
 * `components/sessions/sessionConsoleStatus.ts`; the handlers they mirror are
 * `list_coord_sessions`, `get_coord_session`, `get_coord_session_output`,
 * `get_coord_session_restore_record`, `get_session_claims`,
 * `get_session_agent_status`, `get_session_lineage`, `close_coord_session`,
 * `steal_coord_session`, `handoff_coord_session` and
 * `stream_coord_session_events` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`.
 */

import type { ConsolidatedSessionsResponse } from "@/components/sessions/sessionConsoleStatus";
import type {
  AgentStatusResponse,
  LineageResponse,
  OutputChunkFrame,
  OutputHistoryResponse,
  OutputStream,
  SessionClaimsResponse,
  SessionEventRow,
  SessionListResponse,
  SessionRestoreRecordResponse,
  SessionRow,
} from "@/components/sessions/types";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE } from "./base";

export type ListSessionsScope = "active" | "all";

/** Tenant breadth axis — orthogonal to {@link ListSessionsScope}. */
export type ListSessionsTenantScope = "active" | "all";

export interface ListSessionsOptions {
  /** Session-state filter: `active` only vs include closed. */
  scope?: ListSessionsScope;
  /**
   * Tenant breadth filter: `active` (caller's active tenant only —
   * the default + only meaningful value for single-tenant operators)
   * vs `all` (union across every tenant the caller is a member of).
   */
  tenantScope?: ListSessionsTenantScope;
  /** RFC 3339 timestamp; incremental polling. */
  since?: string;
  signal?: AbortSignal;
}

export async function listSessions(
  opts: ListSessionsOptions = {}
): Promise<SessionListResponse> {
  const params = new URLSearchParams();
  if (opts.scope) params.set("scope", opts.scope);
  if (opts.tenantScope) params.set("tenant_scope", opts.tenantScope);
  if (opts.since) params.set("since", opts.since);

  const qs = params.toString();
  const url = `${OPERATIONS_BASE}/sessions${qs ? `?${qs}` : ""}`;

  const res = await httpClient.fetch(url, {
    signal: opts.signal,
    idempotent: true,
  });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as SessionListResponse;
}

/**
 * Filters for {@link listConsolidatedSessions} — the param vocabulary the three
 * redirected routes bring with them (plan §3's redirect table).
 */
export interface ListConsolidatedSessionsOptions {
  /** coord device uuid. `/environments/sessions?device=` maps here 1:1. */
  device?: string;
  /** Free text. The agent half is searched coord-side; the lifecycle half web-side. */
  q?: string;
  /** coord's own agent-session lifecycle vocabulary. */
  status?: "live" | "stale" | "closed";
  /** Tenant breadth. Same axis as {@link ListSessionsOptions.tenantScope}. */
  tenantScope?: ListSessionsTenantScope;
  signal?: AbortSignal;
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
  const params = new URLSearchParams({ shape: "consolidated" });
  if (opts.device) params.set("device", opts.device);
  if (opts.q) params.set("q", opts.q);
  if (opts.status) params.set("status", opts.status);
  if (opts.tenantScope) params.set("tenant_scope", opts.tenantScope);

  const url = `${OPERATIONS_BASE}/sessions?${params.toString()}`;
  const res = await httpClient.fetch(url, {
    signal: opts.signal,
    idempotent: true,
  });
  if (!res.ok) {
    // `<verb> <url> failed: <status> - <body>` — the shape `httpClient` itself
    // formats, and the ONE shape `console/readFailure.ts::isNotFoundError`
    // can recover a status from. The older helpers in this file stop at the
    // status, so a 404 through them is indistinguishable from a dead socket;
    // this path does not inherit that.
    const body = await res.text().catch(() => "");
    throw new SessionsApiError(
      `GET ${url} failed: ${res.status} - ${body}`,
      res.status
    );
  }
  return (await res.json()) as ConsolidatedSessionsResponse;
}

export async function getSession(
  id: string,
  signal?: AbortSignal
): Promise<SessionRow> {
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, { signal, idempotent: true });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as SessionRow;
}

export type OutputTier = "warm" | "cold";

export interface GetSessionOutputOptions {
  /** `warm` (default) recent scrollback | `cold` archived full history. */
  tier?: OutputTier;
  /**
   * `pty` (default) terminal bytes | `transcript` AI conversation JSONL.
   * Plan `2026-07-09-runner-session-history-cloud-sync` Phase 2 — omitted
   * for `pty` so requests stay compatible with a pre-`stream` coord.
   */
  stream?: OutputStream;
  /** Max warm-tier chunks to fetch. Coord clamps to [1, 65536]; default 4096. */
  limit?: number;
  signal?: AbortSignal;
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
  const params = new URLSearchParams();
  if (opts.tier) params.set("tier", opts.tier);
  if (opts.stream) params.set("stream", opts.stream);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));

  const qs = params.toString();
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(id)}/output${
    qs ? `?${qs}` : ""
  }`;
  const res = await httpClient.fetch(url, {
    signal: opts.signal,
    idempotent: true,
  });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as OutputHistoryResponse;
}

export async function closeSession(id: string): Promise<SessionRow> {
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    idempotent: true,
  });
  if (!res.ok) {
    throw new SessionsApiError(
      `DELETE ${url} failed: ${res.status}`,
      res.status
    );
  }
  return (await res.json()) as SessionRow;
}

export interface StealSessionRequest {
  reason: string;
  machine_id: string;
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
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(id)}/steal`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
    noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
  });
  if (!res.ok) {
    throw new SessionsApiError(`POST ${url} failed: ${res.status}`, res.status);
  }
  return await res.json();
}

export interface HandoffSessionRequest {
  /** The device the session should move to. */
  target_device_id: string;
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
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(id)}/handoff`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
    noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
  });
  if (!res.ok) {
    throw new SessionsApiError(`POST ${url} failed: ${res.status}`, res.status);
  }
  return await res.json();
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
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(id)}/restore-record`;
  const res = await httpClient.fetch(url, { signal, idempotent: true });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as SessionRestoreRecordResponse;
}

export async function getSessionClaims(
  sessionId: string,
  signal?: AbortSignal
): Promise<SessionClaimsResponse> {
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(sessionId)}/claims`;
  const res = await httpClient.fetch(url, { signal, idempotent: true });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as SessionClaimsResponse;
}

export async function getSessionAgentStatus(
  sessionId: string,
  signal?: AbortSignal
): Promise<AgentStatusResponse> {
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(sessionId)}/agent-status`;
  const res = await httpClient.fetch(url, { signal, idempotent: true });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as AgentStatusResponse;
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
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(sessionId)}/lineage`;
  const res = await httpClient.fetch(url, { signal, idempotent: true });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as LineageResponse;
}

/**
 * Statuses a **non-idempotent POST** must NOT be retried on.
 *
 * Shared by every POST in this module and `tenants.ts` whose effect is not a
 * free repeat of the same question: `createTenant` (and `renameTenant`'s
 * PATCH), `handoffSession` and `stealSession`.
 * (`closeSession` is a DELETE to a terminal state — genuinely idempotent — and
 * every other call here is a GET, where retry is the correct behaviour.)
 *
 * The class of bug: `HttpClient` retries every `429` and every `>= 500` up to
 * `maxRetries: 3` with the identical body. For a POST that *does something*,
 * that turns one ambiguous answer into a second side effect. The concrete
 * hazard is the 504 — the web proxy's coord budget is 5s (`operations.py`
 * `_COORD_TIMEOUT`) and a timeout maps to `504 timeout waiting for coord`,
 * which is a statement about OUR clock, not about coord's transaction. From
 * here "coord was slow" and "coord never got it" are indistinguishable, and
 * the client resolved that ambiguity by doing it again:
 *
 *   - tenant creation — coord's create is a plain INSERT that deliberately
 *     rejects a slug collision rather than joining the caller to an existing
 *     tenant, so a create that committed at 5.1s answers 504 and the retry
 *     lands on the unique-violation arm: the operator is told their own
 *     successfully created project "is taken", a false failure they then act
 *     on by picking a different name;
 *   - handoff — coord records a durable `handoff_request` event and publishes
 *     a JetStream subject scoped to the target machine, so the retry
 *     plausibly *succeeds* and one click yields several child sessions;
 *   - steal — lower stakes, but every attempt records its own events.
 *
 * The 429 is here for a different reason: it is a deliberate and persistent
 * answer (a cap, or a limiter). Retrying it only buys round-trips to be told
 * the same thing.
 *
 * The list ENUMERATES statuses rather than declaring a range because
 * `noRetryStatuses` is an `Array.includes` membership test, checked against an
 * unbounded `status >= 500` guard (`http-client.ts`). It covers every status
 * these paths can actually produce: 500 (an unhandled web error, or coord's
 * own 500 forwarded verbatim — e.g. a cap-lookup failure), 501, 502 (coord
 * unreachable), 503 (the app unconfigured / an LB with no healthy target) and
 * 504 (the timeout above).
 *
 * **So it cannot express "all 5xx".** A status nobody enumerated — a `507`
 * from a storage layer, a `520` from a CDN sitting in front of the proxy —
 * falls through the membership test and is still retried, with exactly the
 * same duplicate side effect. An enumeration is only ever as complete as the
 * last person to think about it, which is the standing argument for inverting
 * the client default: make retry opt-IN for POSTs rather than opt-out (this
 * plan's Phase 4). Until that lands, adding a status here is the only fix
 * available.
 */
export const NON_IDEMPOTENT_POST_NO_RETRY_STATUSES: number[] = [
  429, 500, 501, 502, 503, 504,
];

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
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(
    sessionId
  )}/events`;

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
      // A streaming read, so not `httpClient.fetch`: its per-request timeout
      // and internal AbortController would cut a long-lived SSE body. The
      // bearer is attached above, by hand (D6: the transport is kept).
      // eslint-disable-next-line no-restricted-syntax -- streaming SSE reader, bearer attached by hand
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
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(
    sessionId
  )}/events`;

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
      // A streaming read, so not `httpClient.fetch`: its per-request timeout
      // and internal AbortController would cut a long-lived SSE body. The
      // bearer is attached above, by hand (D6: the transport is kept).
      // eslint-disable-next-line no-restricted-syntax -- streaming SSE reader, bearer attached by hand
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