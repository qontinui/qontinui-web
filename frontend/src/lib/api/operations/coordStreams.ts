/**
 * The REST reads and small writes behind the operations dashboard's live
 * tiles: device-status, CI status (+ "notify when green"), symbol claims, dev
 * actions, the migration reservation queue, fleet / per-device volumes, the
 * machine display-name rename and the PR draft-state toggle. (The WebSocket
 * pushes that sit beside them are in `./ws`.)
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * Phase 7). These URLs used to be exports of `components/operations/utils.ts`
 * over the absolute `${ApiConfig.API_BASE_URL}/api/v1/operations`; on the
 * relative {@link OPERATIONS_BASE} they go same-origin through the `/api`
 * rewrite (hop change absolute -> relative, plan D6).
 *
 * Every function returns the raw `Response`, not parsed JSON, on purpose: each
 * caller owns a status-specific reaction that a rejecting reader would erase
 * (the poll hooks render `HTTP <status>`, the volumes readers classify 401 /
 * 404 / 422 / 5xx, `PrDraftStateControl` maps the body to a toast, and the
 * device-status seed reads its body under a deadline). Reads take the caller's
 * `HttpOptions` (the dashboards pass `COORD_DASHBOARD_POLL_OPTIONS`: one
 * request per tick, no client retries). Each function calls `httpClient.fetch`
 * directly with its URL inline; a shared `request(path)` helper would be a
 * wrapper of a wrapper, which `route-walker.test.ts` cannot resolve.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE } from "./base";

/**
 * `GET /device-status` (`get_device_status`). Tenant-scoped server-side via
 * the operator -> tenant_id resolver; the caller passes no tenant_id.
 */
export function getDeviceStatus(options?: HttpOptions): Promise<Response> {
  const url = `${OPERATIONS_BASE}/device-status`;
  return httpClient.fetch(url, options);
}

/**
 * `GET /ci-status` — the CI Status Dashboard read (plan
 * `2026-05-25-ci-status-dashboard-plan.md` Phase 3), tenant-scoped like
 * device-status.
 */
export function getCiStatus(options?: HttpOptions): Promise<Response> {
  const url = `${OPERATIONS_BASE}/ci-status`;
  return httpClient.fetch(url, options);
}

/** Body of {@link postCiStatusNotifyWhenGreen}. */
export interface NotifyWhenGreenRequest {
  repo: string;
  head_sha: string;
}

/**
 * `POST /ci-status/notify-when-green` — arm a `CiGreen` gate for a repo's
 * current main tip (plan Phase 5). The web backend resolves the tenant and
 * forwards to coord's `POST /coord/gates/register`. Not idempotent: a replay
 * would register a second gate.
 */
export function postCiStatusNotifyWhenGreen(
  req: NotifyWhenGreenRequest
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/ci-status/notify-when-green`;
  return httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(req),
    idempotent: false,
  });
}

/**
 * `GET /symbol-claims` — coord's `/coord/claims/list?kind=symbol` proxied so
 * the dashboard can render each machine's "currently editing" sub-line.
 */
export function getSymbolClaims(options?: HttpOptions): Promise<Response> {
  const url = `${OPERATIONS_BASE}/symbol-claims`;
  return httpClient.fetch(url, options);
}

/**
 * `GET /dev-actions/recent?limit=` — recent dev actions from the dev-action
 * ledger (plan `2026-06-07-twin-dev-event-cause-effect-ledger.md`).
 */
export function getRecentDevActions(
  limit: number,
  options?: HttpOptions
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/dev-actions/recent?limit=${limit}`;
  return httpClient.fetch(url, options);
}

/** `GET /dev-actions/{action_id}` — one action and its outcome signatures. */
export function getDevActionDetail(
  actionId: string,
  options?: HttpOptions
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/dev-actions/${encodeURIComponent(actionId)}`;
  return httpClient.fetch(url, options);
}

/**
 * `GET /migrations/queue?repo=` — coord's migration reservation queue for one
 * repo. `repo` is required by coord (the queue is per-repo).
 */
export function getMigrationsQueue(
  repo: string,
  options?: HttpOptions
): Promise<Response> {
  const q = new URLSearchParams({ repo });
  const url = `${OPERATIONS_BASE}/migrations/queue?${q.toString()}`;
  return httpClient.fetch(url, options);
}

/**
 * `GET /fleet/volumes` — the latest volume snapshot for every device in the
 * caller's tenant. A device with no telemetry is ABSENT from the payload; that
 * is UNKNOWN, never zero (plan D10).
 */
export function getFleetVolumes(options?: HttpOptions): Promise<Response> {
  const url = `${OPERATIONS_BASE}/fleet/volumes`;
  return httpClient.fetch(url, options);
}

/** `GET /devices/{device_id}/volumes` — one device's latest volume snapshot. */
export function getDeviceVolumes(
  deviceId: string,
  options?: HttpOptions
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/devices/${encodeURIComponent(deviceId)}/volumes`;
  return httpClient.fetch(url, options);
}

/**
 * `PATCH /fleet/machines/{hostname}` — set (or, with an empty `name`, clear) a
 * machine's operator-friendly display name. Response
 * `{hostname, name: string | null}`. Idempotent: the backend UPSERTs the
 * (user, hostname) row (DELETEs it for an empty name), so a repeat is a no-op.
 */
export function patchMachineName(
  hostname: string,
  name: string
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/fleet/machines/${encodeURIComponent(hostname)}`;
  return httpClient.fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
    idempotent: true,
  });
}

/**
 * `POST /prs/{owner}/{repo}/{number}/draft-state` — set a PR's GitHub draft
 * state (plan `2026-07-23-operator-set-pr-draft-state`). `draft: false` marks
 * it ready-for-review (releasing it to the merge train), `true` converts it
 * back to draft (the documented hold).
 */
export function postPrDraftState(
  owner: string,
  repo: string,
  number: number,
  draft: boolean
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/prs/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}/draft-state`;
  return httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ draft }),
  });
}
