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
