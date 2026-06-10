// ============================================================================
// Commit lineage — API client
//
// Thin wrapper around the web-backend commit-lineage proxy
// (`/api/v1/operations/lineage/*`). Requests route through the shared
// `httpClient`, which attaches the operator Bearer token, handles
// 401-refresh, and adds CSRF headers — so unlike the supervisor's Lineage
// tab there is NO manual JWT paste; the logged-in operator's credential is
// forwarded to coord server-side.
//
// Coord returns enveloped bodies; these helpers unwrap to the array/object
// the components actually want.
// ============================================================================

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API } from "../operations/utils";
import type {
  LineageRow,
  LineageStats,
  RecentCommitsResponse,
  SessionCommitsResponse,
} from "./types";

const LINEAGE_API = `${OPERATIONS_API}/lineage`;

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

/** Read the body (once) and throw the right CommitsApiError for a non-ok
 *  response. Ordinary errors keep today's exact message/status behavior. */
async function throwApiError(url: string, res: Response): Promise<never> {
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    // Body unreadable — treat as an ordinary error below.
  }
  const pending = parseSchemaMigrationPending(res.status, bodyText);
  if (pending) {
    throw new CommitsApiError(
      `GET ${url} failed: ${res.status} (schema migration pending${
        pending.missing ? `: ${pending.missing}` : ""
      })`,
      res.status,
      "schema_migration_pending",
      pending.missing
    );
  }
  throw new CommitsApiError(`GET ${url} failed: ${res.status}`, res.status);
}

/** Newest commit-lineage rows (default 100, coord caps at 500). */
export async function getRecentCommits(
  limit = 100,
  signal?: AbortSignal
): Promise<LineageRow[]> {
  const url = `${LINEAGE_API}/recent?limit=${encodeURIComponent(limit)}`;
  const res = await httpClient.fetch(url, { signal });
  if (!res.ok) {
    await throwApiError(url, res);
  }
  const body = (await res.json()) as RecentCommitsResponse;
  return Array.isArray(body.rows) && body.rows.length > 0
    ? body.rows
    : EMPTY_ROWS;
}

/** Aggregate commit-lineage census (totals + by_source + top_sessions). */
export async function getLineageStats(
  signal?: AbortSignal
): Promise<LineageStats> {
  const url = `${LINEAGE_API}/stats`;
  const res = await httpClient.fetch(url, { signal });
  if (!res.ok) {
    await throwApiError(url, res);
  }
  return (await res.json()) as LineageStats;
}

/** Every commit attributed to a single session (for the drill-down drawer). */
export async function getSessionCommits(
  sessionId: string,
  signal?: AbortSignal
): Promise<LineageRow[]> {
  const url = `${LINEAGE_API}/sessions/${encodeURIComponent(sessionId)}/commits`;
  const res = await httpClient.fetch(url, { signal });
  if (!res.ok) {
    await throwApiError(url, res);
  }
  const body = (await res.json()) as SessionCommitsResponse;
  return Array.isArray(body.commits) && body.commits.length > 0
    ? body.commits
    : EMPTY_ROWS;
}
