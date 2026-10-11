// ============================================================================
// Commit lineage — API client
//
// Thin wrapper around the web-backend commit-lineage proxy
// (`/operations/lineage/*`). Requests route through the shared
// `httpClient`, which attaches the operator Bearer token, handles
// 401-refresh, and adds CSRF headers — so unlike the supervisor's Lineage
// tab there is NO manual JWT paste; the logged-in operator's credential is
// forwarded to coord server-side.
//
// Coord returns enveloped bodies; these helpers unwrap to the array/object
// the components actually want.
// ============================================================================

import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  fetchLineageStats,
  fetchRecentLineage,
  fetchSessionLineageCommits,
} from "@/lib/api/operations/lineage";
import type { LineageRow, LineageStats } from "./types";

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

/** Map a rejection from the typed `/operations` client onto the right
 *  CommitsApiError. A status rejection (`GET <url> failed: <status> - <body>`)
 *  becomes a CommitsApiError whose message stops at the status — ordinary
 *  errors keep today's exact message/status behavior — or the
 *  schema-migration-pending flavour; anything else (a network error, an abort)
 *  is rethrown as it was. */
function toCommitsApiError(err: unknown): unknown {
  const status = httpStatusOf(err);
  if (status === null) return err;
  const request = /^(.+? failed): \d{3}/.exec((err as Error).message)?.[1];
  const head = request ?? `GET failed`;
  const pending = parseSchemaMigrationPending(status, httpBodyOf(err) ?? "");
  if (pending) {
    return new CommitsApiError(
      `${head}: ${status} (schema migration pending${
        pending.missing ? `: ${pending.missing}` : ""
      })`,
      status,
      "schema_migration_pending",
      pending.missing
    );
  }
  return new CommitsApiError(`${head}: ${status}`, status);
}

/** Newest commit-lineage rows (default 100, coord caps at 500). */
export async function getRecentCommits(
  limit = 100,
  signal?: AbortSignal
): Promise<LineageRow[]> {
  const body = await fetchRecentLineage(limit, signal).catch((e: unknown) => {
    throw toCommitsApiError(e);
  });
  return Array.isArray(body.rows) && body.rows.length > 0
    ? body.rows
    : EMPTY_ROWS;
}

/** Aggregate commit-lineage census (totals + by_source + top_sessions). */
export async function getLineageStats(
  signal?: AbortSignal
): Promise<LineageStats> {
  return fetchLineageStats(signal).catch((e: unknown) => {
    throw toCommitsApiError(e);
  });
}

/** Every commit attributed to a single session (for the drill-down drawer). */
export async function getSessionCommits(
  sessionId: string,
  signal?: AbortSignal
): Promise<LineageRow[]> {
  const body = await fetchSessionLineageCommits(sessionId, signal).catch(
    (e: unknown) => {
      throw toCommitsApiError(e);
    }
  );
  return Array.isArray(body.commits) && body.commits.length > 0
    ? body.commits
    : EMPTY_ROWS;
}
