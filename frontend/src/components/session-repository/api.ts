/**
 * Session Repository — API client over `/api/v1/session-repository`
 * (Phase 4 of `2026-08-26-claude-code-session-repository-in-qontinui-web`).
 *
 * Routed through the shared `httpClient`, which attaches the bearer, handles
 * 401-refresh and adds CSRF headers — the same door every sibling
 * `agent.*`-corpus surface uses (`admin/coord/plan-library`).
 *
 * Two deliberate absences:
 *
 * * **The transcript view never calls `/export`.** p99 body is 4 MB and the
 *   corpus is ~3.5 GB; the UI reads {@link getSessionTurns} instead, which is
 *   paged. `/export` is offered only as an explicit operator download, and
 *   only for a row that HAS a body.
 * * **No client-side tenant resolution.** `organization_id` and tenant scoping
 *   are server-side (plan §3.3); nothing here passes a tenant, and nothing
 *   here derives one from the caller's personal org (plan §3.6 rule 1).
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";
import type {
  RelaunchRequest,
  RelaunchResponse,
  SessionArtifactDetailResponse,
  SessionArtifactListResponse,
  SessionTurnsResponse,
  SessionUnfinishedResponse,
} from "./types";

export const SESSION_REPOSITORY_API = "/api/v1/session-repository";

/** Absolute form, for the raw-`fetch` reads that need response headers. */
function absolute(path: string): string {
  return `${ApiConfig.getBaseUrl()}${SESSION_REPOSITORY_API}${path}`;
}

export class SessionRepositoryApiError extends Error {
  readonly status: number;
  /** The parsed error body, where the server sent JSON. */
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown = null) {
    super(message);
    this.name = "SessionRepositoryApiError";
    this.status = status;
    this.body = body;
  }
}

/** Read an error response body as JSON where possible, text otherwise. */
async function errorBody(res: Response): Promise<{ parsed: unknown; text: string }> {
  const text = await res.text().catch(() => "");
  try {
    return { parsed: JSON.parse(text) as unknown, text };
  } catch {
    return { parsed: null, text };
  }
}

/**
 * JSON read that PRESERVES the status code.
 *
 * `httpClient.get` throws a plain `Error` with the status stringified into the
 * message, which is unusable for branching: a pane that must tell "you may not
 * read this" (403) from "the archive has no turns" (404) from "the backend
 * fell over" cannot parse that back out reliably. So the reads go through
 * `httpClient.fetch` — same bearer, same refresh, same CSRF — and map the
 * status onto {@link SessionRepositoryApiError}.
 */
async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const url = absolute(path);
  const res = await httpClient.fetch(url, signal ? { signal } : {});
  if (!res.ok) {
    const { parsed, text } = await errorBody(res);
    throw new SessionRepositoryApiError(
      `GET ${url} failed: ${res.status}${text ? ` - ${text}` : ""}`,
      res.status,
      parsed
    );
  }
  return (await res.json()) as T;
}

/**
 * Filters accepted by `GET /`.
 *
 * `tenantSource`, `bodySource`, `hasSecretFindings` and `detectorRan` are the
 * ones the plan requires to be queryable (§3.6 rule 2, §5, §4.1). They are
 * sent as query params AND the hook verifies the response honours them rather
 * than trusting a 200 — see `useSessionRepository`. A filter chip that lies
 * about what it filtered is worse than no chip.
 */
export interface SessionRepositoryQuery {
  account?: string;
  repo?: string;
  state?: string;
  closeoutState?: string;
  tenantSource?: string;
  bodySource?: string;
  hasSecretFindings?: boolean;
  /** `true` = the detector ran; `false` = it never did. Distinct from clean. */
  detectorRan?: boolean;
  since?: string;
  q?: string;
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
}

function toQuery(query: SessionRepositoryQuery): string {
  const qs = new URLSearchParams();
  if (query.account?.trim()) qs.set("account", query.account.trim());
  if (query.repo?.trim()) qs.set("repo", query.repo.trim());
  // The server names this param `state` (it aliases `session_state`).
  if (query.state?.trim()) qs.set("state", query.state.trim());
  if (query.closeoutState?.trim())
    qs.set("closeout_state", query.closeoutState.trim());
  if (query.tenantSource?.trim())
    qs.set("tenant_source", query.tenantSource.trim());
  if (query.bodySource?.trim()) qs.set("body_source", query.bodySource.trim());
  if (query.hasSecretFindings) qs.set("has_secret_findings", "true");
  if (query.detectorRan !== undefined)
    qs.set("detector_ran", String(query.detectorRan));
  // The server wants a datetime; a bare `YYYY-MM-DD` from the date input is
  // widened to the start of that day in UTC rather than left ambiguous.
  const since = query.since?.trim();
  if (since) {
    qs.set("since", /^\d{4}-\d{2}-\d{2}$/.test(since) ? `${since}T00:00:00Z` : since);
  }
  if (query.q?.trim()) qs.set("q", query.q.trim());
  if (query.offset !== undefined) qs.set("offset", String(query.offset));
  if (query.limit !== undefined) qs.set("limit", String(query.limit));
  return qs.toString();
}

export async function listSessionArtifacts(
  query: SessionRepositoryQuery = {}
): Promise<SessionArtifactListResponse> {
  const qs = toQuery(query);
  return getJson<SessionArtifactListResponse>(
    qs ? `?${qs}` : "",
    query.signal
  );
}

/**
 * `GET /unfinished` — "which sessions were never closed out?", the capability
 * the operator asked for by name (plan §3.4). Served as its own route rather
 * than as `?closeout_state=unfinished` because the server derives the list
 * from three signals; the UI must not re-derive it from one.
 */
export async function listUnfinishedSessions(
  opts: {
    account?: string;
    repo?: string;
    since?: string;
    offset?: number;
    limit?: number;
    signal?: AbortSignal;
  } = {}
): Promise<SessionUnfinishedResponse> {
  const qs = toQuery({
    ...(opts.account !== undefined ? { account: opts.account } : {}),
    ...(opts.repo !== undefined ? { repo: opts.repo } : {}),
    ...(opts.since !== undefined ? { since: opts.since } : {}),
    ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  });
  return getJson<SessionUnfinishedResponse>(
    `/unfinished${qs ? `?${qs}` : ""}`,
    opts.signal
  );
}

export async function getSessionArtifact(
  id: string,
  opts: { includeTurnIndex?: boolean; signal?: AbortSignal } = {}
): Promise<SessionArtifactDetailResponse> {
  // The turn index is a bounded preview the detail page does not render — the
  // paged `/turns` read is what shows the transcript — so it is asked for
  // only when a caller says so. The response then reports
  // `turn_index_state: "not_requested"`, which is honestly different from an
  // empty index.
  const qs = new URLSearchParams({
    include_turn_index: String(opts.includeTurnIndex ?? false),
  });
  return getJson<SessionArtifactDetailResponse>(
    `/${encodeURIComponent(id)}?${qs.toString()}`,
    opts.signal
  );
}

/**
 * `GET /{id}/turns` — the paged transcript read.
 *
 * This is the ONLY door the transcript view uses. The verbatim `/export` body
 * is up to 4 MB (p99) and the UI must not swallow it, which is why the plan
 * spells the paged route out separately.
 */
export async function getSessionTurns(
  id: string,
  opts: {
    from: number;
    limit: number;
    /** Off by default — the raw records are the megabytes this route avoids. */
    includeRaw?: boolean;
    signal?: AbortSignal;
  }
): Promise<SessionTurnsResponse> {
  const qs = new URLSearchParams({
    from: String(opts.from),
    limit: String(opts.limit),
    include_raw: String(opts.includeRaw ?? false),
  });
  return getJson<SessionTurnsResponse>(
    `/${encodeURIComponent(id)}/turns?${qs.toString()}`,
    opts.signal
  );
}

export interface ExportedBody {
  /** The JSONL exactly as the archive holds it. */
  text: string;
  /** `X-Content-Sha256` as SERVED — compared against the head row, not trusted. */
  servedSha256: string | null;
  byteLength: number;
}

/**
 * `GET /{id}/export` — the archived JSONL, byte-verbatim.
 *
 * Uses raw `fetch` because the served digest travels in `X-Content-Sha256`
 * and `httpClient.get` discards headers. The caller is responsible for saying
 * what the digest means: for a `coord_redacted` row it verifies the stored
 * REDACTED copy and nothing else (plan §5).
 */
export async function exportSessionBody(
  id: string,
  signal?: AbortSignal
): Promise<ExportedBody> {
  const url = absolute(`/${encodeURIComponent(id)}/export`);
  const res = await httpClient.fetch(url, signal ? { signal } : {});
  if (!res.ok) {
    throw new SessionRepositoryApiError(
      `GET ${url} failed: ${res.status}`,
      res.status
    );
  }
  const text = await res.text();
  return {
    text,
    servedSha256: res.headers.get("X-Content-Sha256"),
    byteLength: new TextEncoder().encode(text).length,
  };
}

/**
 * `POST /{id}/relaunch`. Admin-gated server-side — it is the one route here
 * that acts on the fleet rather than on the archive.
 *
 * `mode` is required and carries the whole distinction: `resume` dispatches
 * through the shipped handoff subject and restores the conversation;
 * `transfer` returns replay context for a NEW session and dispatches nothing.
 * The 409 body for a pruned coord session is preserved on the thrown error so
 * the panel can render the manual-relaunch parameters the server hands back.
 */
export async function relaunchSession(
  id: string,
  body: RelaunchRequest,
  signal?: AbortSignal
): Promise<RelaunchResponse> {
  const url = absolute(`/${encodeURIComponent(id)}/relaunch`);
  const res = await httpClient.fetch(url, {
    ...(signal ? { signal } : {}),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const { parsed, text } = await errorBody(res);
    throw new SessionRepositoryApiError(
      res.status === 403
        ? "Relaunch and transfer are administrator-only in this tenant."
        : `POST ${url} failed: ${res.status}${text ? ` - ${text}` : ""}`,
      res.status,
      parsed
    );
  }
  return (await res.json()) as RelaunchResponse;
}
