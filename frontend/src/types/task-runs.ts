/**
 * TypeScript types for Task Runs
 *
 * These types correspond to the backend Pydantic models for task runs,
 * findings, and verification results.
 */

// =============================================================================
// Enums
// =============================================================================

/**
 * Task run status enumeration
 */
export type TaskRunStatus = "running" | "complete" | "failed" | "stopped";

/**
 * Task run finding category enumeration
 */
export type TaskRunFindingCategory =
  | "code_bug"
  | "security"
  | "performance"
  | "todo"
  | "enhancement"
  | "config_issue"
  | "test_issue"
  | "documentation"
  | "runtime_issue"
  | "already_fixed"
  | "expected_behavior";

/**
 * Task run finding severity enumeration
 */
export type TaskRunFindingSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

/**
 * Task run finding status enumeration
 */
export type TaskRunFindingStatus =
  | "detected"
  | "in_progress"
  | "needs_input"
  | "resolved"
  | "wont_fix"
  | "deferred";

/**
 * Task run finding action type enumeration
 */
export type TaskRunFindingActionType =
  | "auto_fix"
  | "needs_user_input"
  | "informational";

// =============================================================================
// Core Interfaces
// =============================================================================

/**
 * Task run response from the API
 */
export interface TaskRunBackend {
  id: string;
  project_id: string | null;
  created_by_user_id: string | null;
  runner_id: string | null;
  task_name: string;
  prompt: string;
  status: TaskRunStatus;
  sessions_count: number;
  max_sessions: number | null;
  auto_continue: boolean;
  output_summary: string | null;
  full_output_stored: boolean;
  error_message: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/**
 * Task run session response from the API
 */
export interface TaskRunSession {
  id: string;
  task_id: string;
  session_number: number;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  output_summary: string | null;
}

/**
 * Task run finding response from the API
 */
export interface TaskRunFinding {
  id: string;
  task_id: string;
  category: TaskRunFindingCategory;
  severity: TaskRunFindingSeverity;
  status: TaskRunFindingStatus;
  action_type: TaskRunFindingActionType;
  signature_hash: string | null;
  title: string;
  description: string;
  resolution: string | null;
  file_path: string | null;
  line_number: number | null;
  column_number: number | null;
  code_snippet: string | null;
  detected_in_session: number;
  resolved_in_session: number | null;
  needs_input: boolean;
  question: string | null;
  input_options: string[] | null;
  user_response: string | null;
  detected_at: string;
  resolved_at: string | null;
  updated_at: string;
}

/**
 * Task run finding response (alias for use in summaries)
 */
export type TaskRunFindingResponse = TaskRunFinding;

/**
 * Detailed task run response with sessions and findings
 */
export interface TaskRunBackendDetail extends TaskRunBackend {
  sessions: TaskRunSession[];
  findings: TaskRunFinding[];
  finding_summary: TaskRunFindingSummary;
}

// =============================================================================
// Request/Update Types
// =============================================================================

/**
 * Request to create a new task run
 */
export interface TaskRunCreate {
  id?: string; // Allow runner to specify ID for direct mapping
  project_id?: string;
  runner_id?: string;
  task_name: string;
  prompt: string;
  max_sessions?: number;
  auto_continue?: boolean;
}

/**
 * Request to update a task run
 */
export interface TaskRunUpdate {
  status?: TaskRunStatus;
  sessions_count?: number;
  output_summary?: string;
  full_output?: string;
  full_output_stored?: boolean;
  error_message?: string;
  duration_seconds?: number;
  completed_at?: string;
}

/**
 * Request to update a finding
 */
export interface TaskRunFindingUpdate {
  status?: TaskRunFindingStatus;
  resolution?: string;
  resolved_in_session?: number;
  resolved_at?: string;
  user_response?: string;
}

/**
 * Request to sync findings
 */
export interface TaskRunFindingCreate {
  id?: string;
  category: TaskRunFindingCategory;
  severity: TaskRunFindingSeverity;
  status?: TaskRunFindingStatus;
  action_type?: TaskRunFindingActionType;
  signature_hash?: string;
  title: string;
  description: string;
  resolution?: string;
  file_path?: string;
  line_number?: number;
  column_number?: number;
  code_snippet?: string;
  detected_in_session: number;
  needs_input?: boolean;
  question?: string;
  input_options?: string[];
}

// =============================================================================
// Filter Types
// =============================================================================

/**
 * Filters for listing task runs
 */
export interface TaskRunFilters {
  project_id?: string;
  status?: TaskRunStatus;
  start_date?: string;
  end_date?: string;
  offset?: number;
  limit?: number;
}

/**
 * Filters for listing findings
 */
export interface TaskRunFindingFilters {
  category?: TaskRunFindingCategory;
  severity?: TaskRunFindingSeverity;
  status?: TaskRunFindingStatus;
}

// =============================================================================
// Response Types
// =============================================================================

/**
 * Pagination info
 */
export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/**
 * Response for listing task runs
 */
export interface TaskRunListResponse {
  tasks: TaskRunBackend[];
  pagination: Pagination;
}

/**
 * Finding summary by category/severity/status
 */
export interface TaskRunFindingSummary {
  by_category: Record<TaskRunFindingCategory, number>;
  by_severity: Record<TaskRunFindingSeverity, number>;
  by_status: Record<TaskRunFindingStatus, number>;
  total: number;
}

/**
 * Response for listing findings
 */
export interface TaskRunFindingsListResponse {
  findings: TaskRunFinding[];
  summary: TaskRunFindingSummary;
}

/**
 * Findings summary across all task runs
 */
export interface FindingsSummary {
  total: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
  recent: TaskRunFindingResponse[];
}

// =============================================================================
// Verification Result Types
// =============================================================================

export interface CheckIssueDetail {
  file: string;
  line: number | null;
  column: number | null;
  code: string | null;
  message: string;
  severity: string;
  fixable: boolean;
}

export interface IndividualCheckResult {
  name: string;
  status: string;
  duration_ms: number;
  issues_found: number;
  issues_fixed: number;
  files_checked: number;
  error_message: string | null;
  output: string | null;
  issues: CheckIssueDetail[];
}

export interface VerificationStepDetails {
  step_id: string;
  phase: string;
  stdout: string | null;
  stderr: string | null;
  assertions_passed: number | null;
  assertions_total: number | null;
  console_output: string | null;
  page_snapshot: string | null;
  exit_code: number | null;
  check_results: IndividualCheckResult[] | null;
}

export interface StepExecutionConfig {
  action_type?: string | null;
  target_image_id?: string | null;
  target_image_name?: string | null;
  check_type?: string | null;
  timeout_seconds?: number | null;
  [key: string]: unknown;
}

export interface VerificationStepResult {
  step_index: number;
  step_type: string;
  step_name: string;
  step_id: string | null;
  success: boolean;
  error: string | null;
  screenshot_path: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number;
  config: StepExecutionConfig;
  verification_details: VerificationStepDetails | null;
  output_data: Record<string, unknown> | null;
  comparison_result?: import("@/lib/runner/types/exploration").ComparisonResult;
}

export interface GateEvaluationResult {
  gate_name: string;
  required_step_ids: string[];
  passed_step_ids: string[];
  failed_step_ids: string[];
  missing_step_ids: string[];
  passed: boolean;
}

export interface VerificationPhaseResult {
  iteration: number;
  all_passed: boolean;
  total_steps: number;
  passed_steps: number;
  failed_steps: number;
  skipped_steps: number;
  total_duration_ms: number;
  step_results: VerificationStepResult[];
  critical_failure: boolean;
  gate_results: GateEvaluationResult[];
  gate_based_evaluation: boolean;
}

export interface VerificationResultResponse {
  id: string;
  task_run_id: string;
  iteration: number;
  all_passed: boolean;
  total_steps: number;
  passed_steps: number;
  failed_steps: number;
  skipped_steps: number;
  total_duration_ms: number;
  critical_failure: boolean;
  result_json: VerificationPhaseResult;
  created_at: string;
}

export interface VerificationResultsListResponse {
  task_run_id: string;
  results: VerificationResultResponse[];
  count: number;
  passed_iterations: number;
  failed_iterations: number;
}
