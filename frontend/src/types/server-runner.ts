/**
 * Server-Mode Runner Types
 *
 * Matches backend schemas for Phase 3 server-mode runner fleet:
 *   - Server-mode runners (registered via QONTINUI_RUNNER_TOKEN)
 *   - Runner auth tokens (long-lived bearer tokens for runners)
 *   - Workflow dispatch (send workflow to a registered runner)
 *   - Phase results (streamed iteration-by-iteration results)
 *   - Scheduled workflow runs (cron-style recurring dispatch)
 */

// =============================================================================
// Runner fleet
// =============================================================================

export type ServerRunnerStatus = "healthy" | "unhealthy" | "offline";

export interface ServerRunner {
  id: string;
  user_id: string;
  name: string;
  hostname: string;
  port: number;
  capabilities: string[];
  server_mode: boolean;
  restate_enabled: boolean;
  restate_healthy: boolean;
  last_heartbeat: string | null;
  status: ServerRunnerStatus;
  created_at: string;
}

// =============================================================================
// Runner tokens
// =============================================================================

export interface RunnerToken {
  id: string;
  name: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  is_revoked: boolean;
  revoked_at: string | null;
}

export interface CreateRunnerTokenRequest {
  name: string;
  expires_in_days?: number | null;
}

export interface CreateRunnerTokenResponse {
  token_record: RunnerToken;
  plain_token: string;
}

// =============================================================================
// Workflow dispatch
// =============================================================================

export type DispatchTarget = "auto" | string; // "auto" or a runner UUID

export interface DispatchRequest {
  target: DispatchTarget;
  parent_task_run_id?: string;
}

export interface DispatchResponse {
  execution_id: string;
  runner_id: string;
  runner_hostname: string;
  runner_port: number;
  dispatched_at: string;
  task_run_id: string;
}

// =============================================================================
// Phase results
// =============================================================================

export type WorkflowPhaseName =
  | "setup"
  | "verification"
  | "agentic"
  | "completion";

export interface PhaseStepResult {
  step_id?: string;
  step_type: string;
  step_name: string;
  error?: string | null;
  output_data?: Record<string, unknown> | null;
  duration_ms: number;
  variables_set?: Record<string, unknown> | null;
}

export interface PhaseResult {
  id: string;
  runner_id: string | null;
  execution_id: string;
  phase: WorkflowPhaseName;
  iteration: number | null;
  stage_index: number | null;
  success: boolean;
  all_passed: boolean;
  duration_ms: number;
  failure_context: string | null;
  commit_hash: string | null;
  step_results: PhaseStepResult[];
  variables_set: Record<string, unknown> | null;
  created_at: string;
}

// =============================================================================
// Scheduled runs
// =============================================================================

export type ScheduleLastStatus = "dispatched" | "failed" | null;

export interface ScheduledWorkflowRun {
  id: string;
  workflow_id: string;
  name: string;
  description: string | null;
  cron_expression: string;
  target: DispatchTarget;
  enabled: boolean;
  last_fired_at: string | null;
  last_execution_id: string | null;
  last_status: ScheduleLastStatus;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateScheduledRunRequest {
  workflow_id: string;
  name: string;
  description?: string;
  cron_expression: string;
  target: DispatchTarget;
  enabled: boolean;
}

export interface UpdateScheduledRunRequest {
  name?: string;
  description?: string | null;
  cron_expression?: string;
  target?: DispatchTarget;
  enabled?: boolean;
}
