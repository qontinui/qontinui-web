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
    public readonly status: number
  ) {
    super(message);
    this.name = "CommitsApiError";
  }
}

/** Newest commit-lineage rows (default 100, coord caps at 500). */
export async function getRecentCommits(
  limit = 100,
  signal?: AbortSignal
): Promise<LineageRow[]> {
  const url = `${LINEAGE_API}/recent?limit=${encodeURIComponent(limit)}`;
  const res = await httpClient.fetch(url, { signal });
  if (!res.ok) {
    throw new CommitsApiError(`GET ${url} failed: ${res.status}`, res.status);
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
    throw new CommitsApiError(`GET ${url} failed: ${res.status}`, res.status);
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
    throw new CommitsApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  const body = (await res.json()) as SessionCommitsResponse;
  return Array.isArray(body.commits) && body.commits.length > 0
    ? body.commits
    : EMPTY_ROWS;
}
