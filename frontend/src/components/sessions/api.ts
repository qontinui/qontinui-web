// ============================================================================
// Sessions panel — API client
//
// Thin wrapper around the web-backend session proxy
// (`/api/v1/operations/sessions*`). Centralizes URL building, fetch
// options (credentials, error mapping), and SSE subscription so
// `page.tsx` stays declarative.
//
// All requests are routed through the shared `httpClient` (from
// `@/services/service-factory`) which automatically attaches the
// Bearer token, handles 401-refresh, and adds CSRF headers. SSE
// streams use `httpClient.getAuthToken()` to build auth headers
// manually (httpClient.fetch's internal AbortController would
// conflict with the caller's long-lived signal).
// ============================================================================

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API } from "../operations/utils";
import type {
  AgentStatusResponse,
  LineageResponse,
  OutputChunkFrame,
  OutputHistoryResponse,
  OutputStream,
  RegisteredRepo,
  RegisteredReposResponse,
  SessionClaimsResponse,
  SessionEventRow,
  SessionListResponse,
  SessionRestoreRecordResponse,
  SessionRow,
  TenantCreateRequest,
  TenantCreateResponse,
  TenantListResponse,
} from "./types";

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
  const url = `${OPERATIONS_API}/sessions${qs ? `?${qs}` : ""}`;

  const res = await httpClient.fetch(url, { signal: opts.signal });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as SessionListResponse;
}

export async function getSession(
  id: string,
  signal?: AbortSignal
): Promise<SessionRow> {
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, { signal });
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
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(id)}/output${
    qs ? `?${qs}` : ""
  }`;
  const res = await httpClient.fetch(url, { signal: opts.signal });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as OutputHistoryResponse;
}

export async function closeSession(id: string): Promise<SessionRow> {
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, { method: "DELETE" });
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

export async function stealSession(
  id: string,
  body: StealSessionRequest
): Promise<unknown> {
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(id)}/steal`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
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
 */
export async function handoffSession(
  id: string,
  body: HandoffSessionRequest
): Promise<unknown> {
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(id)}/handoff`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
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
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(id)}/restore-record`;
  const res = await httpClient.fetch(url, { signal });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as SessionRestoreRecordResponse;
}

export async function getSessionClaims(
  sessionId: string,
  signal?: AbortSignal
): Promise<SessionClaimsResponse> {
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(sessionId)}/claims`;
  const res = await httpClient.fetch(url, { signal });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as SessionClaimsResponse;
}

export async function getSessionAgentStatus(
  sessionId: string,
  signal?: AbortSignal
): Promise<AgentStatusResponse> {
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(sessionId)}/agent-status`;
  const res = await httpClient.fetch(url, { signal });
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
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(sessionId)}/lineage`;
  const res = await httpClient.fetch(url, { signal });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as LineageResponse;
}

export async function listTenants(
  signal?: AbortSignal
): Promise<TenantListResponse> {
  const url = `${OPERATIONS_API}/tenants`;
  const res = await httpClient.fetch(url, { signal });
  if (!res.ok) {
    throw new SessionsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as TenantListResponse;
}

/**
 * Error from `POST /api/v1/operations/tenants`, carrying enough for the
 * caller to say something TRUE about what went wrong.
 *
 * The web proxy re-raises coord's status and puts coord's raw response text
 * in FastAPI's `detail`, so the machine-readable reason survives the two
 * hops — but only if we unwrap both layers. `code` is coord's own error
 * token when one was found (`slug_taken`, `invalid_name`, …) and `null`
 * when coord answered something we cannot parse; `detail` is always the
 * most specific human-readable text we could recover, so an unrecognized
 * failure is surfaced verbatim rather than as "something went wrong".
 */
export class TenantCreateError extends Error {
  status: number;
  code: string | null;
  detail: string;
  constructor(status: number, code: string | null, detail: string) {
    super(detail || `POST tenants failed: ${status}`);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.name = "TenantCreateError";
  }
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
 */
export function parseTenantCreateError(
  status: number,
  rawBody: string
): { code: string | null; detail: string } {
  let detail: unknown = rawBody;
  try {
    const outer: unknown = JSON.parse(rawBody);
    if (outer && typeof outer === "object" && "detail" in outer) {
      detail = (outer as { detail: unknown }).detail;
    }
  } catch {
    // Not JSON at all — keep the raw text.
  }

  if (typeof detail !== "string") {
    // A FastAPI 422 validation list, or any object body. No coord code to
    // find; stringify so the operator still sees the real answer.
    return { code: null, detail: JSON.stringify(detail) };
  }

  let code: string | null = null;
  let text = detail;
  try {
    const inner: unknown = JSON.parse(detail);
    if (inner && typeof inner === "object") {
      const obj = inner as Record<string, unknown>;
      const rawCode = obj.error ?? obj.code;
      if (typeof rawCode === "string") code = rawCode;
      const rawMessage = obj.message ?? obj.detail ?? obj.reason;
      if (typeof rawMessage === "string") text = rawMessage;
      else if (code) text = code;
    }
  } catch {
    // coord answered plain text — `text` is already it.
  }
  return { code, detail: text };
}

/**
 * Create a new tenant ("Project") owned by the calling operator.
 *
 * POSTs `/api/v1/operations/tenants`, which proxies coord's
 * `POST /coord/tenants` (plan
 * `2026-08-25-self-service-tenant-project-creation`). Coord creates the
 * tenant, seeds its policy row and grants the caller `admin` in it in ONE
 * transaction, so the membership is readable on the very next
 * `GET /operations/tenants`.
 */
export async function createTenant(
  body: TenantCreateRequest
): Promise<TenantCreateResponse> {
  const url = `${OPERATIONS_API}/tenants`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    const { code, detail } = parseTenantCreateError(res.status, raw);
    throw new TenantCreateError(res.status, code, detail);
  }
  return (await res.json()) as TenantCreateResponse;
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
      const url = `${OPERATIONS_API}/repos`;
      const res = await httpClient.fetch(url, { signal });
      if (!res.ok) {
        throw new SessionsApiError(
          `GET ${url} failed: ${res.status}`,
          res.status
        );
      }
      const data = (await res.json()) as RegisteredReposResponse;
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
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(
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
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(
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
