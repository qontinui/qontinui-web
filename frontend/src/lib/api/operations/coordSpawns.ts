/**
 * `/operations/spawns*` — coord's spawn ledger reads.
 *
 * Part of the typed `/operations` client. The three routes are the web
 * backend's passthrough proxies (`backend/app/api/v1/endpoints/spawn_ledger.py`)
 * of coord's `GET /coord/spawns`, `/coord/spawns/stats` and
 * `/coord/spawns/{id}` — plan
 * `2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration`
 * Phase 5. **Never call coord from the browser**: these carry the operator's
 * bearer and selected tenant, and coord's status and body come back verbatim.
 *
 * Each returns `unknown`. The wire shapes, and the one check that matters
 * before a body is rendered — coord's `{available: false, reason}` answer while
 * the ledger tables are absent — live with their one reader,
 * `admin/coord/spawns/_lib/spawnStatus.ts`, exactly as `fetchComputers` leaves
 * its shapes to `computerStatus.ts`.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** coord's stats windows (`?window=`); its default is `7d`. */
export type SpawnStatsWindow = "24h" | "7d" | "30d";

/** The filters `GET /spawns` forwards to coord. Unset = absent from the query. */
export interface SpawnListQuery {
  /** Only requests in one of these states (coord's comma list). */
  states?: readonly string[];
  /** RFC 3339 instant: requests first requested at or after it. */
  since?: string;
  /** By `requested_at`; coord's default is `desc` (newest first). */
  order?: "asc" | "desc";
  /** Page size, 1–200 (coord's bound; its default is 50). */
  limit?: number;
}

function listQueryString(query: SpawnListQuery): string {
  const params = new URLSearchParams();
  if (query.states !== undefined && query.states.length > 0) {
    params.set("state", query.states.join(","));
  }
  if (query.since !== undefined) params.set("since", query.since);
  if (query.order !== undefined) params.set("order", query.order);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  return params.toString();
}

/** `GET /spawns` (`get_spawns`) — one page of spawn requests, newest first. */
export async function fetchSpawns(
  query: SpawnListQuery,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/spawns?${listQueryString(query)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /spawns/stats?window=` (`get_spawn_stats`) — the window's aggregates. */
export async function fetchSpawnStats(
  window: SpawnStatsWindow,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/spawns/stats?window=${encodeURIComponent(window)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /spawns/{spawn_id}` (`get_spawn`) — one request and its event timeline. */
export async function fetchSpawn(
  spawnId: string,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/spawns/${encodeURIComponent(spawnId)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}
