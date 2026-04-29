// ============================================================================
// Operations Page Types
//
// Mirrors the backend `/api/v1/operations/fleet` and
// `/api/v1/operations/fleet/tasks` endpoints. The runner shape is the
// canonical {@link Runner} from `@qontinui/shared-types`; per-machine
// aggregation (`MachineGroup`) is presentation logic that lives here.
// ============================================================================

import type { Runner } from "@qontinui/shared-types";

export interface ClaudeSessionInfo {
  pid: number;
  working_directory: string | null;
  started_at: string | null;
}

/**
 * Fleet status payload — directly serializes from the unified Runner
 * entity plus a hostname → Claude-session map.
 */
export interface FleetStatus {
  runners: Runner[];
  claude_sessions: Record<string, ClaudeSessionInfo[]>; // hostname -> sessions
  total_runners: number;
  total_healthy: number;
  total_running_tasks: number;
  total_claude_sessions: number;
}

export interface RunnerTaskRun {
  id: string;
  runner_id: string;
  runner_hostname: string | null;
  runner_port: number | null;
  status: string;
  prompt: string | null;
  started_at: string | null;
  workflow_name: string | null;
}

export interface AggregatedTaskRuns {
  task_runs: RunnerTaskRun[];
  total: number;
}

/**
 * Group runners by hostname for the machine-card grid. Hostname-less
 * runners are bucketed under `"unknown"` so they still surface in the
 * grid.
 */
export interface MachineGroup {
  hostname: string;
  runners: Runner[];
  claudeSessions: ClaudeSessionInfo[];
}
