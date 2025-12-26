/**
 * Unified Execution API Types
 *
 * Auto-generated from qontinui-schemas/api/execution.py
 * This file replaces the fragmented testing.ts types.
 *
 * Used by:
 * - Frontend services for API calls
 * - Components displaying execution data
 */

// =============================================================================
// Enums
// =============================================================================

export enum RunType {
  QA_TEST = "qa_test",
  INTEGRATION_TEST = "integration_test",
  LIVE_AUTOMATION = "live_automation",
  RECORDING = "recording",
  DEBUG = "debug",
}

export enum RunStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  TIMEOUT = "timeout",
  CANCELLED = "cancelled",
  PAUSED = "paused",
}

export enum ActionStatus {
  SUCCESS = "success",
  FAILED = "failed",
  TIMEOUT = "timeout",
  SKIPPED = "skipped",
  ERROR = "error",
  PENDING = "pending",
}

export enum ActionType {
  // Vision actions
  FIND = "find",
  FIND_ALL = "find_all",
  EXISTS = "exists",
  VANISH = "vanish",
  WAIT = "wait",
  // Mouse actions
  CLICK = "click",
  DOUBLE_CLICK = "double_click",
  RIGHT_CLICK = "right_click",
  DRAG = "drag",
  SCROLL = "scroll",
  MOUSE_MOVE = "mouse_move",
  // Keyboard actions
  TYPE = "type",
  KEY_PRESS = "key_press",
  HOTKEY = "hotkey",
  // State actions
  GO_TO_STATE = "go_to_state",
  TRANSITION = "transition",
  // Control flow
  IF = "if",
  LOOP = "loop",
  SWITCH = "switch",
  TRY_CATCH = "try_catch",
  // Code execution
  CODE_BLOCK = "code_block",
  SHELL = "shell",
  AI_PROMPT = "ai_prompt",
  // Other
  SCREENSHOT = "screenshot",
  LOG = "log",
  CUSTOM = "custom",
}

export enum ScreenshotType {
  STATE_VERIFICATION = "state_verification",
  BEFORE_ACTION = "before_action",
  AFTER_ACTION = "after_action",
  ON_ERROR = "on_error",
  ON_SUCCESS = "on_success",
  MANUAL = "manual",
  PERIODIC = "periodic",
}

export enum IssueSeverity {
  CRITICAL = "critical",
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  INFO = "info",
}

export enum IssueStatus {
  NEW = "new",
  OPEN = "open",
  IN_PROGRESS = "in_progress",
  RESOLVED = "resolved",
  CLOSED = "closed",
  WONT_FIX = "wont_fix",
}

export enum IssueType {
  FUNCTIONAL = "functional",
  VISUAL = "visual",
  PERFORMANCE = "performance",
  CRASH = "crash",
  TIMEOUT = "timeout",
  ASSERTION = "assertion",
  STATE_MISMATCH = "state_mismatch",
  ELEMENT_NOT_FOUND = "element_not_found",
  AI_DETECTED = "ai_detected",
  OTHER = "other",
}

export enum IssueSource {
  AUTOMATION = "automation",
  AI_ANALYSIS = "ai_analysis",
  VISUAL_REGRESSION = "visual_regression",
  USER_REPORTED = "user_reported",
}

// =============================================================================
// Metadata Types
// =============================================================================

export interface RunnerMetadata {
  runner_version: string;
  os: string;
  hostname: string;
  screen_resolution?: string;
  python_version?: string;
  extra?: Record<string, unknown>;
}

export interface WorkflowMetadata {
  workflow_id: string;
  workflow_name: string;
  workflow_version?: string;
  total_states?: number;
  total_transitions?: number;
  tags?: string[];
}

// =============================================================================
// Execution Run Types
// =============================================================================

export interface ExecutionRunCreate {
  project_id: string;
  run_type: RunType;
  run_name: string;
  description?: string;
  runner_metadata: RunnerMetadata;
  workflow_metadata?: WorkflowMetadata;
  configuration?: Record<string, unknown>;
  max_duration_seconds?: number;
}

export interface ExecutionRunResponse {
  id: string;
  project_id: string;
  run_type: RunType;
  run_name: string;
  status: RunStatus;
  started_at: string;
  ended_at?: string;
  duration_seconds?: number;
  runner_metadata: RunnerMetadata;
  workflow_metadata?: WorkflowMetadata;
  created_at: string;
}

export interface ExecutionStats {
  total_actions: number;
  successful_actions: number;
  failed_actions: number;
  skipped_actions: number;
  timeout_actions: number;
  total_screenshots: number;
  total_issues: number;
  unique_states_visited: number;
  unique_actions_executed: number;
}

export interface CoverageData {
  coverage_percentage: number;
  states_covered: number;
  states_total: number;
  transitions_covered: number;
  transitions_total: number;
  state_coverage_map: Record<string, number>;
  transition_coverage_map: Record<string, number>;
  uncovered_transitions: string[];
}

export interface ExecutionRunDetail extends ExecutionRunResponse {
  description?: string;
  configuration: Record<string, unknown>;
  stats: ExecutionStats;
  coverage?: CoverageData;
  updated_at?: string;
}

export interface ExecutionRunComplete {
  status: RunStatus;
  ended_at: string;
  stats: ExecutionStats;
  coverage?: CoverageData;
  summary?: string;
  error_message?: string;
}

export interface ExecutionRunCompleteResponse {
  id: string;
  status: RunStatus;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  stats: ExecutionStats;
}

// =============================================================================
// Action Execution Types
// =============================================================================

export interface ActionExecutionCreate {
  sequence_number: number;
  action_type: ActionType;
  action_name: string;
  status: ActionStatus;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  from_state?: string;
  to_state?: string;
  actual_state?: string;
  input_data?: Record<string, unknown>;
  output_data?: Record<string, unknown>;
  error_message?: string;
  error_type?: string;
  screenshot_id?: string;
  metadata?: Record<string, unknown>;
}

export interface ActionExecutionBatch {
  actions: ActionExecutionCreate[];
}

export interface ActionExecutionResponse {
  id: string;
  run_id: string;
  sequence_number: number;
  action_type: ActionType;
  action_name: string;
  status: ActionStatus;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  from_state?: string;
  to_state?: string;
  error_message?: string;
}

export interface ActionExecutionBatchResponse {
  run_id: string;
  actions_recorded: number;
  action_ids: string[];
}

// =============================================================================
// Screenshot Types
// =============================================================================

export interface ExecutionScreenshotCreate {
  screenshot_id: string;
  sequence_number: number;
  screenshot_type: ScreenshotType;
  action_sequence_number?: number;
  state_name?: string;
  captured_at: string;
  width: number;
  height: number;
  metadata?: Record<string, unknown>;
}

export interface VisualComparisonResult {
  comparison_id: string;
  baseline_id?: string;
  similarity_score: number;
  threshold: number;
  passed: boolean;
  diff_image_url?: string;
  diff_region_count: number;
}

export interface ExecutionScreenshotResponse {
  id: string;
  run_id: string;
  sequence_number: number;
  screenshot_type: ScreenshotType;
  image_url: string;
  thumbnail_url?: string;
  state_name?: string;
  captured_at: string;
  file_size_bytes: number;
  visual_comparison?: VisualComparisonResult;
}

// =============================================================================
// Issue Types
// =============================================================================

export interface ExecutionIssueCreate {
  issue_type: IssueType;
  severity: IssueSeverity;
  source: IssueSource;
  title: string;
  description: string;
  action_sequence_number?: number;
  state_name?: string;
  screenshot_ids?: string[];
  reproduction_steps?: string[];
  error_details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ExecutionIssueBatch {
  issues: ExecutionIssueCreate[];
}

export interface ExecutionIssueResponse {
  id: string;
  run_id: string;
  issue_type: IssueType;
  severity: IssueSeverity;
  status: IssueStatus;
  source: IssueSource;
  title: string;
  description: string;
  state_name?: string;
  screenshot_count: number;
  created_at: string;
  updated_at: string;
}

export interface ExecutionIssueDetail extends ExecutionIssueResponse {
  action_sequence_number?: number;
  reproduction_steps: string[];
  screenshots: ExecutionScreenshotResponse[];
  error_details: Record<string, unknown>;
  metadata: Record<string, unknown>;
  assigned_to?: {
    user_id: string;
    email: string;
    full_name?: string;
  };
  resolution_notes?: string;
}

export interface ExecutionIssueUpdate {
  status?: IssueStatus;
  severity?: IssueSeverity;
  assigned_to_user_id?: string;
  resolution_notes?: string;
}

export interface ExecutionIssueBatchResponse {
  run_id: string;
  issues_recorded: number;
  issue_ids: string[];
}

// =============================================================================
// List/Query Types
// =============================================================================

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface ExecutionRunListResponse {
  runs: ExecutionRunResponse[];
  pagination: Pagination;
}

export interface ActionExecutionListResponse {
  actions: ActionExecutionResponse[];
  pagination: Pagination;
}

export interface ExecutionIssueListResponse {
  issues: ExecutionIssueResponse[];
  pagination: Pagination;
  summary: {
    by_severity: Record<IssueSeverity, number>;
    by_status: Record<IssueStatus, number>;
    by_type: Record<IssueType, number>;
  };
}

// =============================================================================
// Analytics Types
// =============================================================================

export interface ActionReliabilityStats {
  action_name: string;
  action_type: ActionType;
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  success_rate: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  common_errors: Array<{
    error_type: string;
    count: number;
    percentage: number;
  }>;
}

export interface ExecutionTrendDataPoint {
  date: string;
  runs_count: number;
  success_rate: number;
  avg_duration_seconds: number;
  total_actions: number;
  issues_count: number;
}

export interface ExecutionTrendResponse {
  project_id: string;
  run_type?: RunType;
  start_date: string;
  end_date: string;
  granularity: "daily" | "weekly" | "monthly";
  data_points: ExecutionTrendDataPoint[];
  overall_stats: {
    total_runs: number;
    avg_success_rate: number;
    total_actions: number;
    total_issues: number;
  };
}

// =============================================================================
// Historical Playback Types
// =============================================================================

export interface HistoricalActionQuery {
  action_type?: ActionType;
  action_name?: string;
  state_name?: string;
  success_only?: boolean;
  project_id?: string;
  workflow_id?: string;
  limit?: number;
}

export interface HistoricalActionResult {
  id: string;
  action_type: ActionType;
  action_name: string;
  status: ActionStatus;
  from_state?: string;
  to_state?: string;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown>;
  duration_ms: number;
  screenshot_url?: string;
  has_screenshot: boolean;
}

export interface PlaybackFrameRequest {
  action_ids: string[];
  include_screenshots?: boolean;
}
