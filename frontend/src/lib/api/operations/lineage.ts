/**
 * `/operations/lineage/*` — the commit-lineage proxy behind `/commits`.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * D5, Phase 7). Moved here from `components/commits/api.ts`. Each function
 * mirrors a `_proxy_coord_get` handler in
 * `backend/app/api/v1/endpoints/operations/__init__.py`
 * (`get_lineage_recent`, `get_lineage_stats`, `get_lineage_session_commits`).
 *
 * Requests route through `httpClient.fetch`, which attaches the operator
 * Bearer token, handles 401-refresh and adds CSRF headers — so unlike the
 * supervisor's Lineage tab there is NO manual JWT paste; the logged-in
 * operator's credential is forwarded to coord server-side.
 *
 * Coord returns enveloped bodies; these helpers unwrap to the array/object
 * the components actually want. Each function calls `httpClient.fetch`
 * directly with its URL inline over `OPERATIONS_BASE` (same-origin), parses
 * through `readJson`, and re-throws a non-2xx as a {@link CommitsApiError}.
 */

import type {
  LineageRow,
  LineageStats,
  RecentCommitsResponse,
  SessionCommitsResponse,
} from "@/components/commits/types";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** Stable empty array — never hand a fresh `[]` to identity-memoing consumers. */
const EMPTY_ROWS: LineageRow[] = [];

export class CommitsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Machine-readable error code from the response body, when present
     *  (e.g. "schema_migration_pending" while a coord migration is mid-apply). */
    public readonly code?: string,
    /** For schema_migration_pending: the missing `coord.<table>.<column>`. */
    public readonly missing?: string
  ) {
    super(message);
    this.name = "CommitsApiError";
  }
}

/** True when the error is coord's graceful-degrade 503 emitted while a
 *  required `coord.commit_lineage` column hasn't been migrated yet — the
 *  /commits page renders this as "feature updating", not a generic error. */
export function isSchemaMigrationPending(e: unknown): e is CommitsApiError {
  return (
    e instanceof CommitsApiError &&
    e.status === 503 &&
    e.code === "schema_migration_pending"
  );
}

/** Best-effort parse of coord's schema-migration-pending 503 body.
 *
 *  Coord emits `{"error": "schema_migration_pending", "missing": "coord.t.c"}`,
 *  but the web backend's `_proxy_coord_get` re-raises coord errors as FastAPI
 *  `HTTPException(detail=resp.text)` — so by the time it reaches the browser
 *  the coord body is usually a JSON *string* under `detail`. Handle both
 *  shapes; anything unparseable is just NOT this condition (returns null) and
 *  falls through to ordinary error handling.
 */
function parseSchemaMigrationPending(
  status: number,
  bodyText: string
): { missing?: string } | null {
  if (status !== 503) return null;
  const check = (v: unknown): { missing?: string } | null => {
    if (typeof v !== "object" || v === null) return null;
    const o = v as { error?: unknown; missing?: unknown };
    if (o.error !== "schema_migration_pending") return null;
    return { missing: typeof o.missing === "string" ? o.missing : undefined };
  };
  try {
    const body: unknown = JSON.parse(bodyText);
    const direct = check(body);
    if (direct) return direct;
    const detail = (body as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string") return check(JSON.parse(detail));
    return check(detail);
  } catch {
    return null;
  }
}

/** Map a `readJson` status rejection onto the right {@link CommitsApiError}.
 *  Ordinary errors keep today's exact message/status behavior; anything that
 *  is not a status rejection (a network error, a malformed 2xx body) is
 *  re-thrown unchanged. */
function toCommitsApiError(url: string, err: unknown): unknown {
  const status = httpStatusOf(err);
  if (status === null) return err;
  const pending = parseSchemaMigrationPending(status, httpBodyOf(err) ?? "");
  if (pending) {
    return new CommitsApiError(
      `GET ${url} failed: ${status} (schema migration pending${
        pending.missing ? `: ${pending.missing}` : ""
      })`,
      status,
      "schema_migration_pending",
      pending.missing
    );
  }
  return new CommitsApiError(`GET ${url} failed: ${status}`, status);
}

/**
 * `GET /lineage/recent` — newest commit-lineage rows (default 100, coord caps
 * at 500). Mirrors `get_lineage_recent`.
 */
export async function getRecentCommits(
  limit = 100,
  signal?: AbortSignal
): Promise<LineageRow[]> {
  const url = `${OPERATIONS_BASE}/lineage/recent?limit=${encodeURIComponent(limit)}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    signal,
  });
  const body = await readJson<RecentCommitsResponse>(res, `GET ${url}`).catch(
    (err: unknown) => {
      throw toCommitsApiError(url, err);
    }
  );
  return Array.isArray(body.rows) && body.rows.length > 0
    ? body.rows
    : EMPTY_ROWS;
}

/**
 * `GET /lineage/stats` — aggregate commit-lineage census (totals + by_source +
 * top_sessions). Mirrors `get_lineage_stats`.
 */
export async function getLineageStats(
  signal?: AbortSignal
): Promise<LineageStats> {
  const url = `${OPERATIONS_BASE}/lineage/stats`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    signal,
  });
  return readJson<LineageStats>(res, `GET ${url}`).catch((err: unknown) => {
    throw toCommitsApiError(url, err);
  });
}

/**
 * `GET /lineage/sessions/{session_id}/commits` — every commit attributed to a
 * single session (for the drill-down drawer). Mirrors
 * `get_lineage_session_commits`.
 */
export async function getSessionCommits(
  sessionId: string,
  signal?: AbortSignal
): Promise<LineageRow[]> {
  const url = `${OPERATIONS_BASE}/lineage/sessions/${encodeURIComponent(sessionId)}/commits`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    signal,
  });
  const body = await readJson<SessionCommitsResponse>(res, `GET ${url}`).catch(
    (err: unknown) => {
      throw toCommitsApiError(url, err);
    }
  );
  return Array.isArray(body.commits) && body.commits.length > 0
    ? body.commits
    : EMPTY_ROWS;
}
