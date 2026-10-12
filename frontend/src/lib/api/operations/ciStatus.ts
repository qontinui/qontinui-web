/**
 * `/operations` CI reads: the CI dashboard's `/ci/overview` poll, the
 * `/ci-status` REST seed and its push channel, the `notify-when-green` gate
 * write, and the GitHub-hosted CI read `/ci-hosting`.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7 batch 3). Every REST function calls `httpClient.fetch`
 * on the RELATIVE `OPERATIONS_BASE` (same-origin, D6) with its URL inline,
 * states its retry policy, and returns the PARSED body through `readJson`. A
 * non-2xx rejects with `<METHOD> <url> failed: <status> - <body>`; a caller
 * reads the status with `httpStatusOf`, or words it with
 * `statusOnlyErrorText`.
 *
 * The push channel is the one ABSOLUTE URL here: a WebSocket upgrade cannot go
 * through the Next.js rewrite, so {@link ciStatusWsUrl} is built on
 * `wsUrl()` exactly as `components/operations/utils.ts` built it, token and
 * active tenant in the query string.
 *
 * Wire types are hand-written; each function names the handler it mirrors in
 * `backend/app/api/v1/endpoints/operations/__init__.py`.
 */

import { httpClient } from "@/services/service-factory";
import type {
  CiStatusResponse,
  NotifyWhenGreenResponse,
} from "@/components/operations/types";
import type { CiHostingView } from "@/app/(app)/admin/coord/ci/_lib/hostedCiStatus";
import { OPERATIONS_BASE, activeTenantWsParam, readJson, wsUrl } from "./base";

/**
 * `GET /ci/overview` — `get_ci_overview`, a proxy of coord's
 * `GET /coord/ci/overview` (wire: `CiOverviewWire` in
 * `app/(app)/admin/coord/ci/_lib/ciDashboardStatus.ts`).
 *
 * Resolves `unknown` on purpose: a 2xx without the `pools` / `repos` arrays
 * is NOT an empty overview, and only the caller's `isOverviewBody` may decide
 * it is one. A dashboard poll: one request, no client retries
 * (`maxRetries: 0`) — the next tick is the retry.
 */
export async function fetchCiOverview(): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/ci/overview`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `GET /ci-status` — `get_ci_status` (`response_model=CiStatusResponse`): main
 * verdict and open-PR checks per repo. The REST seed under the
 * {@link ciStatusWsUrl} push channel, and its polling fallback; no client
 * retries (`maxRetries: 0`), the next poll is the retry.
 */
export async function fetchCiStatus(): Promise<CiStatusResponse> {
  const url = `${OPERATIONS_BASE}/ci-status`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<CiStatusResponse>(res, `GET ${url}`);
}

/** The body of `POST /ci-status/notify-when-green` (`NotifyWhenGreenRequest`). */
export interface NotifyWhenGreenWrite {
  repo: string;
  head_sha: string;
}

/**
 * `POST /ci-status/notify-when-green` — `post_ci_status_notify_when_green`,
 * which registers a SHA-keyed `CiGreen` gate on coord. Not re-sent on a 5xx
 * (`idempotent: false`): each send registers a gate.
 */
export async function armNotifyWhenGreen(
  write: NotifyWhenGreenWrite
): Promise<NotifyWhenGreenResponse> {
  const url = `${OPERATIONS_BASE}/ci-status/notify-when-green`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ repo: write.repo, head_sha: write.head_sha }),
    idempotent: false,
  });
  return readJson<NotifyWhenGreenResponse>(res, `POST ${url}`);
}

/**
 * `WS /ci-status/ws?token=<jwt>` — `websocket_ci_status`. The backend
 * authenticates the operator from `token`, mints a tenant-scoped service JWT
 * and bridges coord's CI-status channel. Absolute (see the module note).
 */
export function ciStatusWsUrl(token: string): string {
  return wsUrl(
    `/ci-status/ws?token=${encodeURIComponent(token)}${activeTenantWsParam()}`
  );
}

/**
 * `GET /ci-hosting` — `get_ci_hosting` (`response_model=CiHostingView`), a
 * proxy of coord's `GET /coord/ci-hosting/effective`: the tenant's
 * GitHub-hosted CI default plus one reading per repo.
 */
export async function fetchCiHosting(): Promise<CiHostingView> {
  const url = `${OPERATIONS_BASE}/ci-hosting`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<CiHostingView>(res, `GET ${url}`);
}
