/**
 * WebSocket URL builders for the three `/operations` push bridges:
 * `/device-status/ws`, `/ci-status/ws` and `/coord-events/ws`.
 *
 * Part of the `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * Phase 7), but deliberately NOT built on the relative {@link OPERATIONS_BASE}
 * the REST modules use: a WebSocket upgrade cannot ride the Next `/api`
 * rewrite, so these keep the ABSOLUTE `${ApiConfig.API_BASE_URL}` origin
 * (scheme translated http -> ws, https -> wss). They are URL strings handed to
 * `new WebSocket(...)`, not `httpClient.fetch` calls, so the route walker has
 * nothing to walk here and ignores this module.
 */

import { ApiConfig } from "@/services/api-config";
import { OPERATIONS_BASE } from "./base";

/**
 * The operations base with its scheme translated for a WS upgrade. The base
 * begins with `http://` or `https://`; the browser's URL constructor can't
 * help because we're inserting the WS scheme on top of an HTTP-shaped URL.
 */
function operationsWsBase(): string {
  const base = `${ApiConfig.API_BASE_URL}${OPERATIONS_BASE}`;
  if (base.startsWith("https://")) {
    return "wss://" + base.slice("https://".length);
  }
  if (base.startsWith("http://")) {
    return "ws://" + base.slice("http://".length);
  }
  return "ws://" + base;
}

/**
 * The dashboard tenant-switcher selection as a WS query param. A browser
 * WebSocket cannot send the `X-Qontinui-Active-Tenant` header the REST
 * calls use (HttpClient attaches it from the same localStorage key), so
 * the WS bridges read `active_tenant` from the query string instead. The
 * backend membership-validates it (`_effective_tenant_id`) — a stale or
 * non-member selection degrades to the home tenant server-side.
 */
function activeTenantWsParam(): string {
  if (typeof window === "undefined") return "";
  try {
    const active = window.localStorage.getItem("qontinui.active_tenant_id");
    return active ? `&active_tenant=${encodeURIComponent(active)}` : "";
  } catch {
    return "";
  }
}

/**
 * WebSocket URL for the Phase 1.3 device-status push channel. Bridges
 * to coord's `/ws/device-status` after minting a tenant-scoped
 * service JWT on the server side. The frontend authenticates via the
 * `token` query-param pattern (the JS WS API can't set custom headers on the
 * upgrade).
 */
export function deviceStatusWsUrl(token: string): string {
  return `${operationsWsBase()}/device-status/ws?token=${encodeURIComponent(token)}${activeTenantWsParam()}`;
}

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
 * Same shape as {@link deviceStatusWsUrl}: the backend authenticates the
 * operator from `token`, mints a tenant-scoped coord service JWT, opens
 * `wss://<coord>/ws?token=<minted>&subscribe=<name>` and relays every
 * `{channel, payload}` frame verbatim. Replaces the direct browser→coord
 * sockets the strategy and merge-pipeline hooks used to open on
 * `NEXT_PUBLIC_COORD_WS_URL`, which coord's authenticated `/ws` refuses
 * (plan
 * 2026-09-13-coord-publishes-agent-jwts-on-a-redis-channel-fronted-by-an-unauthenticated-ws-firehose).
 */
export function coordEventsWsUrl(
  subscribe: CoordEventSubscription,
  token: string
): string {
  return `${operationsWsBase()}/coord-events/ws?subscribe=${subscribe}&token=${encodeURIComponent(token)}${activeTenantWsParam()}`;
}

/**
 * WebSocket URL for the CI-status push channel. Mirrors
 * {@link deviceStatusWsUrl}: bridges to coord's CI-status WS after the web
 * backend mints a tenant-scoped service JWT. Authenticates via the
 * `token` query-param (the JS WS API can't set headers on upgrade).
 */
export function ciStatusWsUrl(token: string): string {
  return `${operationsWsBase()}/ci-status/ws?token=${encodeURIComponent(token)}${activeTenantWsParam()}`;
}
