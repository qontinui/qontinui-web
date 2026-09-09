/**
 * Runner-related types.
 *
 * The canonical {@link Runner} entity comes from `@qontinui/shared-types`
 * — see `qontinui-schemas/rust/src/runner.rs`. This module only carries
 * web-specific request/response shapes that aren't part of the canonical
 * runner entity (e.g. session-history paging, dispatch payloads).
 */

import type { Runner } from "@qontinui/shared-types";
export type { Runner };

// =============================================================================
// Tenant bindings (which tenants a device is paired to)
// =============================================================================

/**
 * One tenant a device is paired to, as coord reports it via the web
 * backend's `GET /api/v1/devices` (`DeviceTenantBinding` in
 * `backend/app/schemas/device.py`).
 */
export interface DeviceTenantBinding {
  /** Tenant identifier (UUID as a string). */
  tenant_id: string;
  /** Tenant slug when coord resolved one; `null` otherwise. */
  tenant_slug: string | null;
  /** RFC 3339 timestamp of the binding's last activity; `null` when coord holds none. */
  last_active_at: string | null;
}

/**
 * A device row as the web backend serves it: the canonical {@link Runner}
 * entity plus its tenant bindings.
 *
 * `tenant_bindings` is TRI-STATE and every consumer must keep it so:
 * - `null` — UNKNOWN. Coord (or an older web backend) did not report
 *   bindings. Never render as "no tenants".
 * - `[]` — coord measured ZERO bindings.
 * - a non-empty array — the tenants the device is paired to.
 */
export type RegisteredDevice = Runner & {
  tenant_bindings: DeviceTenantBinding[] | null;
};

// =============================================================================
// Session history (audit log of past WS sessions per runner)
// =============================================================================

export interface RunnerSessionFilters {
  limit?: number;
  offset?: number;
  search?: string;
  start_date?: string;
  end_date?: string;
  runner_id?: string;
}

export interface RunnerSession {
  id: number;
  runner_id: string;
  runner_name: string;
  connected_at: string;
  disconnected_at: string | null;
  duration_seconds: number | null;
  ip_address: string | null;
  user_agent: string | null;
}

export interface RunnerSessionsResponse {
  sessions: RunnerSession[];
  total: number;
  active_count: number;
  limit: number;
  offset: number;
}

// =============================================================================
// Workflow dispatch
// =============================================================================

export interface DispatchPayload {
  workflow_id: string;
  payload?: Record<string, unknown>;
}

export interface DispatchResult {
  execution_id: string;
  runner_id: string;
  runner_name: string;
  dispatched_at: string;
  task_run_id: string;
}
