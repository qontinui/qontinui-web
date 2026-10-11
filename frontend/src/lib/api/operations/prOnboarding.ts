/**
 * `/operations/pr-merge/onboarding/*` — the GitHub App connect flow's two web
 * proxies: the single-use connect-state mint and the pending-installation read.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` with its URL inline and returns the PARSED body
 * through `readJson`; a non-2xx rejects with `<METHOD> <url> failed: <status> -
 * <body>`. The callers word that rejection for their own surface.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * Coord's envelope for `GET /coord/onboarding/pending-installations`, passed
 * through verbatim by `GET /pr-merge/onboarding/pending-installation`.
 */
export interface PendingInstallationResponse {
  /** `true` = seen and unclaimed; `false` = claimed or never seen; `null` = UNKNOWN. */
  pending: boolean | null;
  installation_id: number | null;
  account_login: string | null;
  account_type: string | null;
  repo_count: number | null;
  received_at: string | null;
  claimed_at: string | null;
  /** Set on the UNKNOWN arm: `"pending_installations_table_absent"`. */
  reason?: string;
}

/**
 * `POST /pr-merge/onboarding/connect-state` — mints a single-use,
 * tenant-bound connect-state token from coord (the proxy forwards the
 * operator's bearer; coord's mint is Cognito-gated). Never retried
 * (`maxRetries: 0`): a mint allocates a single-use row, and retrying it
 * silently would leak rows and mask a genuine coord outage.
 *
 * Resolves the body as an untyped record, or `null` for a 2xx whose body does
 * not parse — the caller treats both as "no token".
 */
export async function postConnectState(
  payload: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/connect-state`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(payload),
    maxRetries: 0,
  });
  return readJson<Record<string, unknown>>(res, `POST ${url}`, {
    unparseable: "null",
  });
}

/**
 * `GET /pr-merge/onboarding/pending-installation?<key>` — one
 * pending-installation row. Exactly one key (`installation_id` or
 * `account_login`) — the same rule coord and the proxy enforce (400 otherwise).
 */
export async function fetchPendingInstallationRow(
  params: URLSearchParams
): Promise<PendingInstallationResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/pending-installation?${params.toString()}`;
  const res = await httpClient.fetch(url);
  return readJson<PendingInstallationResponse>(res, `GET ${url}`);
}
