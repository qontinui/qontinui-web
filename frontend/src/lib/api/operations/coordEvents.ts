/**
 * The coord-events push channel: the web backend's bridge to coord's
 * authenticated `/ws`.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7 batch 7). Handler mirrored: `websocket_coord_events` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`. Like every
 * `/operations` WebSocket it is ABSOLUTE, built on `wsUrl()`: an upgrade
 * cannot ride the same-origin `/api/:path*` rewrite the REST reads use.
 */

import { activeTenantWsParam, wsUrl } from "./base";

/**
 * The named subscriptions the web backend's coord-events bridge forwards
 * to coord's generic `/ws`. Coord takes a CLOSED set (`?subscribe=<name>`,
 * each mapped server-side to a fixed pattern — `merge` → `events.merge.*`,
 * `claims` → `events.claims`, `branches` → `events.branches`); a
 * caller-supplied glob is refused. Mirrors `COORD_EVENTS_SUBSCRIPTIONS` in
 * `backend/app/services/coord_device_status.py`, which is the gate: a name
 * absent there closes 1008 `unknown_subscription` before any auth. The
 * runner-only `device` / `device_ci` names are deliberately not here.
 */
export type CoordEventSubscription = "merge" | "claims" | "branches";

/**
 * WebSocket URL for the coord-events bridge,
 * `WS /api/v1/operations/coord-events/ws?subscribe=<name>&token=<jwt>`.
 * Same shape as `deviceStatusWsUrl` (`./deviceStatus.ts`): the backend
 * authenticates the operator from `token`, mints a tenant-scoped coord service
 * JWT, opens `wss://<coord>/ws?token=<minted>&subscribe=<name>` and relays
 * every `{channel, payload}` frame verbatim. Replaces the direct
 * browser→coord sockets the strategy and merge-pipeline hooks used to open on
 * `NEXT_PUBLIC_COORD_WS_URL`, which coord's authenticated `/ws` refuses (plan
 * 2026-09-13-coord-publishes-agent-jwts-on-a-redis-channel-fronted-by-an-unauthenticated-ws-firehose).
 */
export function coordEventsWsUrl(
  subscribe: CoordEventSubscription,
  token: string
): string {
  return wsUrl(
    `/coord-events/ws?subscribe=${subscribe}&token=${encodeURIComponent(token)}${activeTenantWsParam()}`
  );
}
