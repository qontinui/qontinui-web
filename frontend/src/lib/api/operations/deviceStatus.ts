/**
 * `/operations/device-status`: the fleet tile's REST seed and its push
 * channel.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7 batch 3). The REST read calls `httpClient.fetch` on
 * the RELATIVE `OPERATIONS_BASE` (same-origin, D6) with its URL inline and
 * states its retry policy. The push channel is ABSOLUTE: a WebSocket upgrade
 * cannot go through the Next.js rewrite, so {@link deviceStatusWsUrl} is built
 * on `wsUrl()` exactly as `components/operations/utils.ts` built it.
 *
 * Handlers mirrored: `get_device_status` and `websocket_device_status` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`; the body is
 * `DeviceStatusResponse` (`components/operations/types.ts`).
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, activeTenantWsParam, wsUrl } from "./base";

/**
 * `GET /device-status` — `get_device_status`, tenant-scoped server-side.
 *
 * Resolves the `Response` UNREAD, unlike the rest of this client. The one
 * caller, `useDeviceStatusStream`, reads the body under its own deadline and
 * aborts the request through `signal` when the body stalls — `httpClient`'s
 * abort timer is cleared once headers arrive — so parsing here would put that
 * read beyond the deadline's reach. The caller checks `ok` itself.
 *
 * No client retries (`maxRetries: 0`): a failed read is re-read by the next
 * poll or the seed retry.
 */
export async function fetchDeviceStatusResponse(
  signal: AbortSignal
): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/device-status`, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
    signal,
  });
}

/**
 * `WS /device-status/ws?token=<jwt>` — `websocket_device_status`. The backend
 * authenticates the operator from `token` (a browser WebSocket cannot set
 * headers on the upgrade), mints a tenant-scoped service JWT and bridges
 * coord's `/ws/device-status`.
 */
export function deviceStatusWsUrl(token: string): string {
  return wsUrl(
    `/device-status/ws?token=${encodeURIComponent(token)}${activeTenantWsParam()}`
  );
}
