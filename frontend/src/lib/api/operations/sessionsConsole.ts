/**
 * `/operations/sessions*`, `/operations/tenants*` and `/operations/repos` — the
 * Sessions console's reads and writes: the session lists, one session and its
 * output / restore record / claims / agent status / lineage, the close / steal
 * / handoff writes, the project (tenant) list + create + rename, and the
 * registered repos.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` with its URL inline, states its retry policy, and
 * returns the PARSED body through `readJson`; a non-2xx rejects with
 * `<METHOD> <url> failed: <status> - <body>`. `components/sessions/api.ts` maps
 * that into the console's `SessionsApiError` / `TenantCreateError` /
 * `TenantRenameError`, so the error text the console renders is unchanged.
 *
 * The session event stream is the one raw-`fetch` consumer (a long-lived SSE
 * read cannot ride `httpClient.fetch`'s own AbortController), and, like the
 * push channels, it is the one ABSOLUTE URL: {@link sessionEventsUrl}.
 */

import { ApiConfig } from "@/services/api-config";
import { httpClient } from "@/services/service-factory";
import type { ConsolidatedSessionsResponse } from "@/components/sessions/sessionConsoleStatus";
import type {
  AgentStatusResponse,
  LineageResponse,
  OutputHistoryResponse,
  OutputStream,
  RegisteredReposResponse,
  SessionClaimsResponse,
  SessionListResponse,
  SessionRestoreRecordResponse,
  SessionRow,
  TenantCreateRequest,
  TenantCreateResponse,
  TenantListResponse,
  TenantRenameRequest,
  TenantRenameResponse,
} from "@/components/sessions/types";
import { OPERATIONS_BASE, readJson } from "./base";

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

/**
 * Filters for {@link fetchConsolidatedSessions} — the param vocabulary the three
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

export interface StealSessionRequest {
  reason: string;
  machine_id: string;
}

export interface HandoffSessionRequest {
  /** The device the session should move to. */
  target_device_id: string;
}

/**
 * Statuses a **non-idempotent POST** must NOT be retried on.
 *
 * Shared by every write here whose effect is not a free repeat of the same
 * question: tenant create + rename, handoff and steal. (`closeSession` is a
 * DELETE to a terminal state — genuinely idempotent — and every read is a GET,
 * where retry is the correct behaviour.)
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

/** `GET /sessions[?scope=…&tenant_scope=…&since=…]` — the session list. */
export async function fetchSessions(
  opts: ListSessionsOptions = {}
): Promise<SessionListResponse> {
  const params = new URLSearchParams();
  if (opts.scope) params.set("scope", opts.scope);
  if (opts.tenantScope) params.set("tenant_scope", opts.tenantScope);
  if (opts.since) params.set("since", opts.since);

  const qs = params.toString();
  const url = `${OPERATIONS_BASE}/sessions${qs ? `?${qs}` : ""}`;
  const res = await httpClient.fetch(url, { signal: opts.signal });
  return readJson<SessionListResponse>(res, `GET ${url}`);
}

/**
 * `GET /sessions?shape=consolidated` — ONE list read, joined backend-side
 * across `coord.sessions` and `coord.agent_sessions`, with a first-class
 * `row_class` discriminant per row.
 *
 * There is no session-state `scope` here and that is deliberate: the
 * consolidated shape always reads `scope=all` (the `agent_only` class is a set
 * difference and is only sound over the complete lifecycle set), and `status`
 * is the narrowing the caller actually wants.
 */
export async function fetchConsolidatedSessions(
  opts: ListConsolidatedSessionsOptions = {}
): Promise<ConsolidatedSessionsResponse> {
  const params = new URLSearchParams({ shape: "consolidated" });
  if (opts.device) params.set("device", opts.device);
  if (opts.q) params.set("q", opts.q);
  if (opts.status) params.set("status", opts.status);
  if (opts.tenantScope) params.set("tenant_scope", opts.tenantScope);

  const url = `${OPERATIONS_BASE}/sessions?${params.toString()}`;
  const res = await httpClient.fetch(url, { signal: opts.signal });
  return readJson<ConsolidatedSessionsResponse>(res, `GET ${url}`);
}

/** `GET /sessions/{id}` — one session. */
export async function fetchSession(
  id: string,
  signal?: AbortSignal
): Promise<SessionRow> {
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, { signal });
  return readJson<SessionRow>(res, `GET ${url}`);
}

/**
 * `GET /sessions/{id}/output[?tier=…&stream=…&limit=…]` — a session's recorded
 * PTY output (or transcript), oldest to newest.
 */
export async function fetchSessionOutput(
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
  const res = await httpClient.fetch(url, { signal: opts.signal });
  return readJson<OutputHistoryResponse>(res, `GET ${url}`);
}

/** `DELETE /sessions/{id}` — closes a session (a terminal state, so idempotent). */
export async function deleteSession(id: string): Promise<SessionRow> {
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, { method: "DELETE" });
  return readJson<SessionRow>(res, `DELETE ${url}`);
}

/**
 * `POST /sessions/{id}/steal` — takes ownership of a session away from the
 * machine currently holding it. **Never retried**: each attempt records its own
 * coord events (see {@link NON_IDEMPOTENT_POST_NO_RETRY_STATUSES}).
 */
export async function postSessionSteal(
  id: string,
  body: StealSessionRequest
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(id)}/steal`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
  });
  return readJson<unknown>(res, `POST ${url}`);
}

/**
 * `POST /sessions/{id}/handoff` — hands a session off to another machine
 * ("Continue elsewhere"; plan §Phase 7). **Never retried**: a retry of an
 * ambiguous 504 plausibly *succeeds*, so the target runner materializes a
 * second child session from a single click.
 */
export async function postSessionHandoff(
  id: string,
  body: HandoffSessionRequest
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(id)}/handoff`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
  });
  return readJson<unknown>(res, `POST ${url}`);
}

/**
 * `GET /sessions/{id}/restore-record` — the session's latest `restore-record`
 * (+ `handoff_request`) events (plan
 * `2026-07-09-runner-session-history-cloud-sync` Phase 4). Both fields are null
 * when the session has no such event in coord's 100-row replay window.
 */
export async function fetchSessionRestoreRecord(
  id: string,
  signal?: AbortSignal
): Promise<SessionRestoreRecordResponse> {
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(id)}/restore-record`;
  const res = await httpClient.fetch(url, { signal });
  return readJson<SessionRestoreRecordResponse>(res, `GET ${url}`);
}

/** `GET /sessions/{id}/claims` — the claims a session holds. */
export async function fetchSessionClaims(
  sessionId: string,
  signal?: AbortSignal
): Promise<SessionClaimsResponse> {
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(sessionId)}/claims`;
  const res = await httpClient.fetch(url, { signal });
  return readJson<SessionClaimsResponse>(res, `GET ${url}`);
}

/** `GET /sessions/{id}/agent-status` — the session's coord agent status. */
export async function fetchSessionAgentStatus(
  sessionId: string,
  signal?: AbortSignal
): Promise<AgentStatusResponse> {
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(sessionId)}/agent-status`;
  const res = await httpClient.fetch(url, { signal });
  return readJson<AgentStatusResponse>(res, `GET ${url}`);
}

/**
 * `GET /sessions/{id}/lineage` — the coord agent-session lineage
 * (worktree/claim/build/merge timeline), proxying
 * `GET /coord/agent-sessions/:id/lineage`.
 */
export async function fetchSessionLineage(
  sessionId: string,
  signal?: AbortSignal
): Promise<LineageResponse> {
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(sessionId)}/lineage`;
  const res = await httpClient.fetch(url, { signal });
  return readJson<LineageResponse>(res, `GET ${url}`);
}

/** `GET /tenants` — the caller's projects. */
export async function fetchTenants(
  signal?: AbortSignal
): Promise<TenantListResponse> {
  const url = `${OPERATIONS_BASE}/tenants`;
  const res = await httpClient.fetch(url, { signal });
  return readJson<TenantListResponse>(res, `GET ${url}`);
}

/**
 * `POST /tenants` — creates a tenant ("Project") owned by the caller, which
 * proxies coord's `POST /coord/tenants` (plan
 * `2026-08-25-self-service-tenant-project-creation`). **Never retried**: see
 * {@link NON_IDEMPOTENT_POST_NO_RETRY_STATUSES}.
 */
export async function postTenant(
  body: TenantCreateRequest
): Promise<TenantCreateResponse> {
  const url = `${OPERATIONS_BASE}/tenants`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
  });
  return readJson<TenantCreateResponse>(res, `POST ${url}`);
}

/**
 * `PATCH /tenants/{tenant_id}` — renames a tenant (display name, slug, or
 * both), proxying coord's `PATCH /coord/tenants/:tenant_id` (plan
 * `2026-09-17-tenant-rename`). **Never retried**, for the same reason as
 * {@link postTenant}: a rename that committed at 5.1s answers 504, and a retry
 * is then judged against the NEW slug.
 */
export async function patchTenant(
  tenantId: string,
  body: TenantRenameRequest
): Promise<TenantRenameResponse> {
  const url = `${OPERATIONS_BASE}/tenants/${encodeURIComponent(tenantId)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
    // Longer than the default 60s ceiling, on purpose. A rename that changes
    // the slug is followed on the backend by the home-group migration, which
    // costs one Cognito write per member of the old group and is bounded by
    // its own budget. If the browser gives up first, the operator is told the
    // outcome is UNKNOWN for work the backend went on to finish and report —
    // the answer exists, we just stopped listening for it. This ceiling sits
    // above the backend's own so the report wins that race.
    timeoutMs: 120_000,
  });
  return readJson<TenantRenameResponse>(res, `PATCH ${url}`);
}

/** `GET /repos` — the registered repos. */
export async function fetchRegisteredRepos(
  signal?: AbortSignal
): Promise<RegisteredReposResponse> {
  const url = `${OPERATIONS_BASE}/repos`;
  const res = await httpClient.fetch(url, { signal });
  return readJson<RegisteredReposResponse>(res, `GET ${url}`);
}

/**
 * The URL of a session's `/events` SSE stream: ABSOLUTE (`API_BASE_URL` +
 * {@link OPERATIONS_BASE}), as the stream was always read — a long-lived
 * chunked read goes straight to the backend rather than through the Next.js
 * `/api/:path*` rewrite. The caller builds its own auth headers and abort
 * signal, so this is a URL and nothing else.
 */
export function sessionEventsUrl(sessionId: string): string {
  return `${ApiConfig.API_BASE_URL}${OPERATIONS_BASE}/sessions/${encodeURIComponent(
    sessionId
  )}/events`;
}
