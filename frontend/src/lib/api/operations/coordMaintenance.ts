/**
 * Routes of coord's machine / maintenance-window surface behind
 * `/api/v1/operations/fleet/{machines,maintenance-window}` (plan
 * `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place` Phase 6).
 *
 * URL builders only: `useMaintenanceWindow` reads the raw `Response` because
 * it has to tell coord's `schema_pending` 503 and an absent route's 404 apart
 * from a failure, which a throwing `readJson` client would flatten. The route
 * strings live here so no component hand-types an `/operations` URL
 * (`ratchet.test.ts`).
 */
import { OPERATIONS_BASE } from "./base";

/** `GET /fleet/machines` — machines plus CI hosts linked to none. */
export const FLEET_MACHINES_API = `${OPERATIONS_BASE}/fleet/machines`;

/** `GET|POST /fleet/maintenance-window` — list or open windows. */
export const MAINTENANCE_WINDOW_API = `${OPERATIONS_BASE}/fleet/maintenance-window`;

/** `/fleet/machines/{device_id}/ci-hosts` — one machine's declared CI hosts. */
export function machineCiHostsUrl(deviceId: string): string {
  return `${FLEET_MACHINES_API}/${encodeURIComponent(deviceId)}/ci-hosts`;
}

/** `/fleet/maintenance-window/{id}` — one window. */
export function windowUrl(windowId: string): string {
  return `${MAINTENANCE_WINDOW_API}/${encodeURIComponent(windowId)}`;
}

/** `/fleet/maintenance-window/{id}/readiness` — the restart verdict. */
export function windowReadinessUrl(windowId: string): string {
  return `${windowUrl(windowId)}/readiness`;
}
