/**
 * `/operations/migrations/queue`: the coord-authoritative migration
 * reservation queue, per repo.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7 batch 3). Calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` (same-origin, D6) with its URL inline, states its retry
 * policy, and returns the PARSED body through `readJson`.
 *
 * Handler mirrored: `get_migrations_queue` in
 * `backend/app/api/v1/endpoints/operations/__init__.py` (a proxy of coord's
 * `GET /coord/migrations/queue?repo=`); body `MigrationQueueResponse`
 * (`components/operations/types.ts`).
 */

import { httpClient } from "@/services/service-factory";
import type { MigrationQueueResponse } from "@/components/operations/types";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /migrations/queue?repo=<owner/name>` — `get_migrations_queue`. `repo`
 * is required (coord 400s without it) and is form-encoded, so its `/` is sent
 * as `%2F`, as `URLSearchParams` always sent it. A dashboard poll: no client
 * retries (`maxRetries: 0`), the next tick is the retry.
 */
export async function fetchMigrationQueue(
  repo: string
): Promise<MigrationQueueResponse> {
  const url = `${OPERATIONS_BASE}/migrations/queue?${new URLSearchParams({ repo }).toString()}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<MigrationQueueResponse>(res, `GET ${url}`);
}
