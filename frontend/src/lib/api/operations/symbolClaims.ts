/**
 * `/operations/symbol-claims`: live `ClaimKind::Symbol` claims, the
 * "currently editing" sub-line on each machine card.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7 batch 3). Kept apart from `claims.ts` (the
 * resource-claim reads) because it is a different coord surface with its own
 * consumer. Calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE`
 * (same-origin, D6) with its URL inline, states its retry policy, and returns
 * the PARSED body through `readJson`.
 *
 * Handler mirrored: `get_symbol_claims` in
 * `backend/app/api/v1/endpoints/operations/__init__.py` (a proxy of coord's
 * `/coord/claims/list?kind=symbol`); body `SymbolClaimsResponse`
 * (`components/operations/types.ts`).
 */

import { httpClient } from "@/services/service-factory";
import type { SymbolClaimsResponse } from "@/components/operations/types";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /symbol-claims` — `get_symbol_claims`. A dashboard poll: no client
 * retries (`maxRetries: 0`), the next tick is the retry.
 */
export async function fetchSymbolClaims(): Promise<SymbolClaimsResponse> {
  const url = `${OPERATIONS_BASE}/symbol-claims`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<SymbolClaimsResponse>(res, `GET ${url}`);
}
