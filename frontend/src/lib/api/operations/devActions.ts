/**
 * `/operations/dev-actions`: the dev-action ledger tile's recent-actions poll
 * and its per-action outcome detail.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7 batch 3). Every function calls `httpClient.fetch` on
 * the RELATIVE `OPERATIONS_BASE` (same-origin, D6) with its URL inline, states
 * its retry policy, and returns the PARSED body through `readJson`; a non-2xx
 * rejects with `GET <url> failed: <status> - <body>`.
 *
 * Handlers mirrored: `get_dev_actions_recent` and `get_dev_action_detail` in
 * `backend/app/api/v1/endpoints/operations/__init__.py` (proxies of coord's
 * `/coord/dev-actions/*`); bodies are `DevActionsResponse` / `DevActionDetail`
 * (`components/operations/types.ts`).
 */

import { httpClient } from "@/services/service-factory";
import type {
  DevActionDetail,
  DevActionsResponse,
} from "@/components/operations/types";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /dev-actions/recent?limit=<n>` — `get_dev_actions_recent`. A dashboard
 * poll: no client retries (`maxRetries: 0`), the next tick is the retry.
 */
export async function fetchRecentDevActions(
  limit: number
): Promise<DevActionsResponse> {
  const url = `${OPERATIONS_BASE}/dev-actions/recent?limit=${limit}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<DevActionsResponse>(res, `GET ${url}`);
}

/**
 * `GET /dev-actions/{action_id}` — `get_dev_action_detail`: one action and
 * the outcome signatures observed for it. A one-shot read on expanding a row,
 * so it keeps `httpClient`'s default retry budget.
 */
export async function fetchDevActionDetail(
  actionId: string
): Promise<DevActionDetail> {
  const url = `${OPERATIONS_BASE}/dev-actions/${encodeURIComponent(actionId)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<DevActionDetail>(res, `GET ${url}`);
}
