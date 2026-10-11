/**
 * `/operations/lineage/*` — the commit-lineage proxy: the newest lineage rows,
 * the aggregate census, and one session's commits.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` with its URL inline, forwards the caller's
 * `AbortSignal`, and returns the PARSED body through `readJson`; a non-2xx
 * rejects with `GET <url> failed: <status> - <body>`. The `/commits` page maps
 * that into its own `CommitsApiError` (see `components/commits/api.ts`).
 */

import { httpClient } from "@/services/service-factory";
import type {
  LineageStats,
  RecentCommitsResponse,
  SessionCommitsResponse,
} from "@/components/commits/types";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /lineage/recent?limit=…` — the newest commit-lineage rows (coord caps at 500). */
export async function fetchRecentLineage(
  limit: number,
  signal?: AbortSignal
): Promise<RecentCommitsResponse> {
  const url = `${OPERATIONS_BASE}/lineage/recent?limit=${encodeURIComponent(limit)}`;
  const res = await httpClient.fetch(url, { signal });
  return readJson<RecentCommitsResponse>(res, `GET ${url}`);
}

/** `GET /lineage/stats` — totals + by_source + top_sessions. */
export async function fetchLineageStats(
  signal?: AbortSignal
): Promise<LineageStats> {
  const url = `${OPERATIONS_BASE}/lineage/stats`;
  const res = await httpClient.fetch(url, { signal });
  return readJson<LineageStats>(res, `GET ${url}`);
}

/** `GET /lineage/sessions/{id}/commits` — every commit attributed to one session. */
export async function fetchSessionLineageCommits(
  sessionId: string,
  signal?: AbortSignal
): Promise<SessionCommitsResponse> {
  const url = `${OPERATIONS_BASE}/lineage/sessions/${encodeURIComponent(sessionId)}/commits`;
  const res = await httpClient.fetch(url, { signal });
  return readJson<SessionCommitsResponse>(res, `GET ${url}`);
}
