/**
 * Runner token, dispatch, phase result, and scheduled-run types.
 *
 * The {@link Runner} entity itself lives in `@qontinui/shared-types` (see
 * `src/types/runner.ts`). This module carries the auxiliary concerns that
 * surround a runner: long-lived auth tokens, workflow-dispatch payloads,
 * iteration phase results, and cron-style scheduled dispatches.
 */

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
  workflow_id: string;
  payload?: Record<string, unknown>;
  parent_task_run_id?: string;
}

export interface DispatchResponse {
  execution_id: string;
  runner_id: string;
  runner_name: string;
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
