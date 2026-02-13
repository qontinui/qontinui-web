/**
 * TypeScript types for AI Tasks
 *
 * These types correspond to the backend Pydantic models in
 * app/services/ai_task_service.py and app/models/ai_task.py
 */

// =============================================================================
// Enums
// =============================================================================

/**
 * AI Task status enumeration
 */
export type AITaskStatus = "running" | "complete" | "failed" | "stopped";

/**
 * AI Task finding category enumeration
 */
export type AITaskFindingCategory =
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
 * AI Task finding severity enumeration
 */
export type AITaskFindingSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

/**
 * AI Task finding status enumeration
 */
export type AITaskFindingStatus =
  | "detected"
  | "in_progress"
  | "needs_input"
  | "resolved"
  | "wont_fix"
  | "deferred";

/**
 * AI Task finding action type enumeration
 */
export type AITaskFindingActionType =
  | "auto_fix"
  | "needs_user_input"
  | "informational";

// =============================================================================
// Core Interfaces
// =============================================================================

/**
 * AI Task response from the API
 */
export interface AITask {
  id: string;
  project_id: string | null;
  created_by_user_id: string | null;
  runner_id: string | null;
  task_name: string;
  prompt: string;
  status: AITaskStatus;
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
 * AI Task session response from the API
 */
export interface AITaskSession {
  id: string;
  task_id: string;
  session_number: number;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  output_summary: string | null;
}

/**
 * AI Task finding response from the API
 */
export interface AITaskFinding {
  id: string;
  task_id: string;
  category: AITaskFindingCategory;
  severity: AITaskFindingSeverity;
  status: AITaskFindingStatus;
  action_type: AITaskFindingActionType;
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
 * Detailed AI Task response with sessions and findings
 */
export interface AITaskDetail extends AITask {
  sessions: AITaskSession[];
  findings: AITaskFinding[];
  finding_summary: AITaskFindingSummary;
}

// =============================================================================
// Request/Update Types
// =============================================================================

/**
 * Request to create a new AI task
 */
export interface AITaskCreate {
  id?: string; // Allow runner to specify ID for direct mapping
  project_id?: string;
  runner_id?: string;
  task_name: string;
  prompt: string;
  max_sessions?: number;
  auto_continue?: boolean;
}

/**
 * Request to update an AI task
 */
export interface AITaskUpdate {
  status?: AITaskStatus;
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
export interface AITaskFindingUpdate {
  status?: AITaskFindingStatus;
  resolution?: string;
  resolved_in_session?: number;
  resolved_at?: string;
  user_response?: string;
}

/**
 * Request to sync findings
 */
export interface AITaskFindingCreate {
  id?: string;
  category: AITaskFindingCategory;
  severity: AITaskFindingSeverity;
  status?: AITaskFindingStatus;
  action_type?: AITaskFindingActionType;
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
 * Filters for listing AI tasks
 */
export interface AITaskFilters {
  project_id?: string;
  status?: AITaskStatus;
  start_date?: string;
  end_date?: string;
  offset?: number;
  limit?: number;
}

/**
 * Filters for listing findings
 */
export interface AITaskFindingFilters {
  category?: AITaskFindingCategory;
  severity?: AITaskFindingSeverity;
  status?: AITaskFindingStatus;
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
 * Response for listing AI tasks
 */
export interface AITaskListResponse {
  tasks: AITask[];
  pagination: Pagination;
}

/**
 * Finding summary by category/severity/status
 */
export interface AITaskFindingSummary {
  by_category: Record<AITaskFindingCategory, number>;
  by_severity: Record<AITaskFindingSeverity, number>;
  by_status: Record<AITaskFindingStatus, number>;
  total: number;
}

/**
 * Response for listing findings
 */
export interface AITaskFindingsListResponse {
  findings: AITaskFinding[];
  summary: AITaskFindingSummary;
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
