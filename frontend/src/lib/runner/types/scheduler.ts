// =============================================================================
// Scheduler Types - TypeScript equivalents of Rust scheduler types
// =============================================================================

// Re-export ScheduleExpression from the canonical @qontinui/shared-types
// package. The local duplicate definition had `rearm_delay_minutes?: number`,
// but the schemars-tightened TS type promotes it to required, causing a
// mismatch at the describeSchedule() call site.
import type { ScheduleExpression } from "@qontinui/shared-types/scheduler";
export type { ScheduleExpression };

// =============================================================================
// Condition Types
// =============================================================================

export interface IdleCondition {
  enabled: boolean;
}

export interface RepositoryWatch {
  path: string;
  inactive_minutes: number;
}

export interface RepositoryInactiveCondition {
  enabled: boolean;
  repositories: RepositoryWatch[];
}

export interface ScheduleConditions {
  require_idle?: IdleCondition;
  require_repo_inactive?: RepositoryInactiveCondition;
  timeout_minutes?: number;
}

export interface ConditionStatus {
  waiting_since: string;
  idle_met?: boolean;
  repo_inactive_met?: [string, boolean][];
  timed_out: boolean;
}

// =============================================================================
// Task Types
// =============================================================================

// Tagged union matching Rust's serde(tag = "task_type")
export type ScheduledTaskType =
  | {
      task_type: "Workflow";
      workflow_name: string;
      config_path?: string;
      monitor_index?: number;
    }
  | { task_type: "Prompt"; prompt_id: string; max_sessions?: number }
  | { task_type: "AutoFix"; check_findings: boolean; force_run: boolean };

export type ScheduledTaskStatus =
  | "Pending"
  | "Running"
  | "Completed"
  | "Failed"
  | "Skipped"
  | "Cancelled";

export interface TaskExecutionRecord {
  execution_id: string;
  session_id?: string;
  started_at: string;
  ended_at?: string;
  status: ScheduledTaskStatus;
  success: boolean;
  error_message?: string;
  triggered_auto_fix: boolean;
  auto_fix_session_id?: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  schedule: ScheduleExpression;
  task: ScheduledTaskType;
  skip_if_completed: boolean;
  auto_fix_on_failure: boolean;
  success_criteria?: string;
  created_at: string;
  modified_at: string;
  last_run?: TaskExecutionRecord;
  next_run?: string;
  conditions?: ScheduleConditions;
  condition_status?: ConditionStatus;
}

// =============================================================================
// Scheduler Settings & Status
// =============================================================================

export interface SchedulerSettings {
  enabled: boolean;
  max_concurrent: number;
  default_auto_fix_on_failure: boolean;
  timezone?: string;
}

export interface SchedulerStatus {
  enabled: boolean;
  running_tasks: number;
  pending_tasks: number;
  next_task?: {
    id: string;
    name: string;
    next_run: string;
  };
}

// =============================================================================
// Request Types
// =============================================================================

export interface CreateScheduledTaskRequest {
  name: string;
  description?: string;
  schedule: ScheduleExpression;
  task: ScheduledTaskType;
  skip_if_completed?: boolean;
  auto_fix_on_failure?: boolean;
  success_criteria?: string;
  conditions?: ScheduleConditions;
}

export interface UpdateScheduledTaskRequest {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  schedule?: ScheduleExpression;
  task?: ScheduledTaskType;
  skip_if_completed?: boolean;
  auto_fix_on_failure?: boolean;
  success_criteria?: string | null;
  conditions?: ScheduleConditions | null;
}
