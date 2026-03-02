// =============================================================================
// Task Run Types
// =============================================================================

/** Result of a single iteration in the verification-agentic loop. */
export interface IterationResult {
  /** Iteration number (1-based) */
  iteration: number;
  /** Whether all verification checks passed in this iteration */
  verification_passed: boolean;
  /** Whether a critical failure occurred */
  critical_failure: boolean;
  /** Number of verification checks that passed */
  passed_checks: number;
  /** Number of verification checks that failed */
  failed_checks: number;
  /** Whether the agentic phase ran in this iteration */
  agentic_phase_ran: boolean;
  /** Whether the agentic phase succeeded (null if not run) */
  agentic_phase_success?: boolean | null;
}

/** Complete result of the verification-agentic loop execution. */
export interface LoopResult {
  /** Total number of iterations executed */
  iterations_run: number;
  /** Whether verification ultimately passed */
  verification_passed: boolean;
  /** Whether the loop reached max iterations without passing */
  max_iterations_reached: boolean;
  /** Whether a critical failure stopped the loop */
  critical_failure: boolean;
  /** Whether the loop was manually stopped */
  was_stopped: boolean;
  /** Per-iteration results */
  iteration_results: IterationResult[];
  /** Human-readable summary of the loop execution */
  summary: string;
}

/** Information about why a run failed. */
export interface FailureInfo {
  /** Primary reason for failure */
  reason: string;
  /** Name of the step that failed */
  failed_step?: string;
  /** Detailed error message or stack trace */
  error_details?: string;
  /** Error type category */
  error_type?: string;
}

export interface RunnerHealth {
  status: string;
  version?: string;
  uptime_seconds?: number;
}

export interface TaskRun {
  id: string;
  task_name: string;
  prompt?: string;
  task_type?: string;
  status: string;
  sessions_count?: number;
  max_sessions?: number;
  auto_continue?: boolean;
  output_log?: string;
  workflow_name?: string;
  workflow_type?: string;
  depth?: number;
  created_at: string;
  updated_at?: string;
  completed_at?: string;
  summary?: string;
  ai_summary?: string;
  iteration_count?: number;
  phase?: string;
  /** Duration in seconds (computed from created_at/completed_at) */
  duration_seconds?: number;
  /** Whether the goal was achieved */
  goal_achieved?: boolean;
  /** When the AI summary was generated */
  summary_generated_at?: string;
  /** Remaining work description (when goal not achieved) */
  remaining_work?: string;
  /** Loop execution result with per-iteration breakdown */
  loop_result?: LoopResult | null;
  /** Structured failure information */
  failure_info?: FailureInfo | null;
}

export interface TaskRunOutput {
  id: number;
  output_log: string;
}

export interface TaskRunKnowledge {
  findings: Finding[];
  observations: string[];
  hypotheses: string[];
}

export interface Finding {
  id: number;
  task_run_id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  file_path?: string;
  line_number?: number;
  status: string;
  created_at: string;
}

export interface VerificationResult {
  id: number;
  task_run_id: string;
  criterion: string;
  passed: boolean;
  confidence: number;
  observation: string;
  verified_at: string;
}

export interface PlaywrightResult {
  id: number;
  task_run_id: string;
  test_name: string;
  status: string;
  duration_ms: number;
  error_message?: string;
  screenshot_path?: string;
  console_output?: string;
  page_snapshot?: string;
  assertions_passed?: number;
  assertions_failed?: number;
  failure_screenshot_path?: string;
}

// =============================================================================
// Verification Phase Results (Unified Workflow Step-Executor Based)
// =============================================================================

/** Details of an individual issue found by a check */
export interface CheckIssueDetail {
  /** File path where the issue was found */
  file: string;
  /** Line number (1-based) */
  line?: number | null;
  /** Column number (1-based) */
  column?: number | null;
  /** Rule code (e.g., "E501", "no-unused-vars") */
  code?: string | null;
  /** Issue message */
  message: string;
  /** Severity level: "error", "warning", "info" */
  severity: "error" | "warning" | "info";
  /** Whether this issue is fixable */
  fixable: boolean;
}

/** Individual check result within a check group */
export interface IndividualCheckResult {
  /** Check name */
  name: string;
  /** Status: "passed", "failed", "skipped" */
  status: "passed" | "failed" | "skipped";
  /** Duration in milliseconds */
  duration_ms: number;
  /** Number of issues found */
  issues_found: number;
  /** Number of issues fixed (if auto-fix is enabled) */
  issues_fixed: number;
  /** Number of files checked */
  files_checked: number;
  /** Error message if failed */
  error_message: string | null;
  /** Raw output from the check tool */
  output: string | null;
  /** Individual issues found */
  issues: CheckIssueDetail[];
}

/** Step execution config from the verification phase. */
export interface StepExecutionConfig {
  action_type?: string | null;
  test_type?: string | null;
  check_type?: string | null;
  command?: string | null;
  working_directory?: string | null;
  [key: string]: unknown;
}

/** Verification-specific details for test and check steps. */
export interface VerificationStepDetails {
  step_id: string;
  phase: string;
  stdout?: string | null;
  stderr?: string | null;
  assertions_passed?: number | null;
  assertions_total?: number | null;
  console_output?: string | null;
  page_snapshot?: string | null;
  exit_code?: number | null;
  check_results?: IndividualCheckResult[] | null;
}

/** Individual step execution result from the verification phase. */
export interface VerificationStepResult {
  step_index: number;
  step_name: string;
  step_type: string;
  success: boolean;
  error?: string | null;
  duration_ms: number;
  screenshot_path?: string | null;
  config: StepExecutionConfig;
  verification_details?: VerificationStepDetails | null;
}

/** Result of running verification steps for a single iteration. */
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
}

/** Result of querying verification phase results from the runner. */
export interface VerificationPhaseResultsData {
  task_run_id: string;
  results: VerificationPhaseResult[];
  count: number;
  passed_iterations: number;
  failed_iterations: number;
}

export interface TaskRunEvent {
  id: number;
  task_run_id: string;
  event_type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface Screenshot {
  id: number;
  task_run_id: string;
  filename: string;
  path: string;
  timestamp: string;
  description?: string;
}

export interface TaskRunScreenshot {
  id: number;
  task_run_id: string;
  timestamp: string;
  path: string;
  url?: string;
  data?: string;
  description?: string;
  phase?: string;
  step?: string;
}

export interface SessionState {
  state: string;
  can_send: boolean;
  can_interrupt: boolean;
}

export interface SendMessageResponse {
  success: boolean;
  queued: boolean;
  state: string;
}

export interface FindingsSummary {
  total: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
  recent: Finding[];
}

export interface Checkpoint {
  id: string;
  execution_id: string;
  workflow_type: string;
  phase: string;
  iteration: number | null;
  step_index: number;
  step_type: string;
  step_name: string | null;
  status: string;
  result_json: string | null;
  step_config_json: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
}

export interface McpCall {
  id: number;
  task_run_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: string;
  duration_ms?: number;
  timestamp: string;
}

/** Summary returned alongside verification results from the API */
export interface VerificationSummary {
  total: number;
  passed: number;
  failed: number;
  critical_failed: number;
  all_passed: boolean;
}

/** Combined verification data including results and summary */
export interface VerificationData {
  results: VerificationResult[];
  summary: VerificationSummary | null;
}

/** Step execution data from /current-execution/steps endpoint */
export interface CurrentExecutionStep {
  id: string;
  step_type: string;
  step_name: string;
  step_index?: number;
  phase?: string;
  iteration?: number;
  /** Stage index for multi-stage workflows (0-based). Null/undefined for single-stage. */
  stage_index?: number;
  status: string;
  start_time?: number;
  end_time?: number;
  duration_ms?: number;
  error?: string;
  output?: string;
  stdout?: string;
  /** Command mode for unified command steps (shell/check/check_group/test) */
  command_mode?: string;
}

export interface CurrentExecutionStepsResponse {
  success: boolean;
  task_run_id: string | null;
  workflow_name?: string;
  workflow_type?: string;
  workflow_start_time?: string;
  current_stage?: string;
  executions: CurrentExecutionStep[];
  count: number;
  /** Batch endpoint fields — present when fetching from /current-execution/batch */
  completed_iterations?: number[];
  has_setup?: boolean;
  has_verification?: boolean;
  has_agentic?: boolean;
  /** Multi-stage workflow fields */
  current_stage_index?: number;
  total_stages?: number;
  stage_names?: string[];
}

// GUI lock status - indicates whether a visual automation run holds the GUI
export interface GuiLockInfo {
  holder_id: string | null;
  acquired_at: number | null;
}
