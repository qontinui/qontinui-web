/**
 * `/operations/session-runs*` — coord's session run-record reads.
 *
 * Part of the typed `/operations` client. The four routes are the web
 * backend's passthrough proxies (`backend/app/api/v1/endpoints/session_runs.py`)
 * of coord's `GET /coord/session-runs`, `/stats`, `/concurrency` and
 * `/growth` — plan
 * `2026-10-23-session-duration-by-work-type-and-per-device-session-load`
 * Phase 5. **Never call coord from the browser**: these carry the operator's
 * bearer and selected tenant, and coord's status and body come back verbatim.
 *
 * Each returns `unknown`. The wire shapes, and the readings that matter
 * before a body is rendered — coord's `503 {"error": "schema_missing"}` while
 * `coord.session_runs` is not migrated among them — live with their one
 * reader, `admin/coord/session-load/_lib/sessionLoadStatus.ts`, exactly as
 * `coordSpawns.ts` leaves its shapes to `spawnStatus.ts`.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** coord's window grammar: a whole number of days or hours. */
export type SessionRunsWindow = `${number}d` | `${number}h`;

/** coord's `group_by` for the stats read. */
export type SessionRunsGroupBy = "work_type" | "device" | "device,work_type";

/** coord's concurrency bucket widths. */
export type ConcurrencyBucket = "1m" | "5m" | "15m" | "1h" | "6h" | "1d" | "7d";

/** The growth read buckets by day or by week. */
export type GrowthBucket = "day" | "week";

/** The filters `GET /session-runs` forwards to coord. Unset = absent from the query. */
export interface SessionRunListQuery {
  workType?: string;
  device?: string;
  /** `operator`, `coord`, `runner_local` or `unknown` (coord's CHECK). */
  initiator?: string;
  /** RFC 3339 instant: runs started at or after it. */
  since?: string;
  /** coord's `next_cursor` from the previous page. */
  cursor?: string;
  /** Page size, 1–500 (coord's bound; its default is 50). */
  limit?: number;
}

function listQueryString(query: SessionRunListQuery): string {
  const params = new URLSearchParams();
  if (query.workType !== undefined) params.set("work_type", query.workType);
  if (query.device !== undefined) params.set("device", query.device);
  if (query.initiator !== undefined) params.set("initiator", query.initiator);
  if (query.since !== undefined) params.set("since", query.since);
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  return params.toString();
}

/** `GET /session-runs` (`get_session_runs`) — one page of runs, newest first. */
export async function fetchSessionRuns(
  query: SessionRunListQuery,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/session-runs?${listQueryString(query)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /session-runs/stats` (`get_session_run_stats`) — durations and counts per group. */
export async function fetchSessionRunStats(
  window: SessionRunsWindow,
  groupBy: SessionRunsGroupBy,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/session-runs/stats?window=${encodeURIComponent(window)}&group_by=${encodeURIComponent(groupBy)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /session-runs/concurrency` (`get_session_run_concurrency`) — open runs per device. */
export async function fetchSessionRunConcurrency(
  window: SessionRunsWindow,
  bucket: ConcurrencyBucket,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/session-runs/concurrency?window=${encodeURIComponent(window)}&bucket=${encodeURIComponent(bucket)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /session-runs/growth` (`get_session_run_growth`) — slot-hours per bucket against the fleet's. */
export async function fetchSessionRunGrowth(
  window: SessionRunsWindow,
  bucket: GrowthBucket,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/session-runs/growth?window=${encodeURIComponent(window)}&bucket=${encodeURIComponent(bucket)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}
