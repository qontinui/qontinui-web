/**
 * Auto-generated TypeScript types from qontinui-schemas
 * DO NOT EDIT - regenerate with: poetry run python scripts/generate_typescript.py
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Auto-generated types from Python schema; any is intentional for generic metadata fields */

export enum TestRunStatus {
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  TIMEOUT = "timeout",
  CANCELLED = "cancelled",
}

export enum TransitionStatus {
  SUCCESS = "success",
  FAILED = "failed",
  TIMEOUT = "timeout",
  SKIPPED = "skipped",
  ERROR = "error",
}

export enum DeficiencySeverity {
  CRITICAL = "critical",
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  INFO = "informational",
}

export enum DeficiencyStatus {
  NEW = "new",
  OPEN = "open",
  IN_PROGRESS = "in_progress",
  RESOLVED = "resolved",
  CLOSED = "closed",
  WONT_FIX = "wont_fix",
}

export enum DeficiencyType {
  FUNCTIONAL = "functional_bug",
  VISUAL = "ui_issue",
  PERFORMANCE = "performance",
  CRASH = "crash",
  SECURITY = "security",
  ACCESSIBILITY = "accessibility",
  DATA = "data",
  OTHER = "other",
}

export enum ScreenshotType {
  ERROR = "error",
  SUCCESS = "success",
  MANUAL = "manual",
  PERIODIC = "periodic",
  STATE_VERIFICATION = "state_verification",
  ACTION_RESULT = "action_result",
  BEFORE_ACTION = "before_action",
  AFTER_ACTION = "after_action",
}

export interface TestRunCreate {
  /** Project ID */
  project_id: string;
  /** Name of the test run */
  run_name: string;
  /** Optional description */
  description?: string | null;
  /** Metadata about the runner environment */
  runner_metadata: Record<string, any>;
  /** Metadata about the workflow being tested */
  workflow_metadata: Record<string, any>;
  /** Snapshot of the test configuration */
  configuration_snapshot: Record<string, any>;
}

export interface TransitionCreate {
  /** Order within test run */
  sequence_number: number;
  /** Source state */
  from_state: string;
  /** Destination state */
  to_state: string;
  /** Transition name */
  transition_name: string;
  /** Transition status */
  status: TransitionStatus;
  /** Transition start time */
  started_at: string;
  /** Transition completion time */
  completed_at: string;
  /** Duration in milliseconds */
  duration_ms: number;
  /** Error message if failed */
  error_message?: string | null;
  /** Error type if failed */
  error_type?: string | null;
  /** Associated screenshot ID */
  screenshot_id?: string | null;
  /** Additional transition metadata */
  metadata?: Record<string, any>;
}

export interface TransitionBatchCreate {
  /** List of transitions */
  transitions: TransitionCreate[];
}

export interface DeficiencyCreate {
  /** Deficiency title */
  title: string;
  /** Detailed description */
  description: string;
  /** Severity level */
  severity: DeficiencySeverity;
  /** Type of deficiency */
  deficiency_type: DeficiencyType;
  /** Related transition sequence number */
  transition_sequence_number?: number | null;
  /** State where occurred */
  state?: string | null;
  /** Associated screenshot IDs */
  screenshot_ids?: string[];
  /** Steps to reproduce */
  reproduction_steps?: string[];
  /** Additional metadata */
  metadata?: Record<string, any>;
}

export interface DeficiencyBatchCreate {
  /** List of deficiencies */
  deficiencies: DeficiencyCreate[];
}

export interface DeficiencyUpdate {
  /** New status */
  status?: DeficiencyStatus | null;
  /** New severity */
  severity?: DeficiencySeverity | null;
  /** Assign to user */
  assigned_to_user_id?: string | null;
  /** Resolution notes */
  resolution_notes?: string | null;
}

export interface CoverageUpdate {
  /** Total executed */
  total_transitions_executed: number;
  /** Unique covered */
  unique_transitions_covered: number;
  /** Coverage % */
  coverage_percentage: number;
  /** Map of transition names to execution counts */
  transition_coverage_map?: Record<string, any>;
  /** Map of state names to visit counts */
  state_coverage_map?: Record<string, any>;
  /** List of uncovered transitions */
  uncovered_transitions?: string[];
}

export interface TestRunComplete {
  /** Final status */
  status: string;
  /** End time */
  ended_at: string;
  /** Final test metrics */
  final_metrics: Record<string, any>;
  /** Optional summary text */
  summary?: string | null;
}

export interface ScreenshotMetadata {
  /** Screenshot ID (client-generated) */
  screenshot_id: string;
  /** Screenshot sequence number */
  sequence_number: number;
  /** Associated transition sequence number */
  transition_sequence_number?: number | null;
  /** State when taken */
  state?: string | null;
  /** Screenshot type */
  screenshot_type: ScreenshotType;
  /** Screenshot timestamp */
  timestamp: string;
  /** Image width */
  width: number;
  /** Image height */
  height: number;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

export interface Pagination {
  /** Total number of items */
  total: number;
  /** Items per page */
  limit: number;
  /** Number of items skipped */
  offset: number;
  /** Whether more items exist */
  has_more: boolean;
}

export interface TestRunResponse {
  /** Unique test run identifier */
  run_id: string;
  /** Project ID */
  project_id: string;
  /** Name of the test run */
  run_name: string;
  /** Test run status */
  status: TestRunStatus;
  /** Test run start time */
  started_at: string;
  /** Test run end time */
  ended_at?: string | null;
  /** Duration in seconds */
  duration_seconds?: number | null;
  /** Runner metadata */
  runner_metadata: Record<string, any>;
  /** Record creation time */
  created_at: string;
}

export interface TestRunDetail {
  /** Unique test run identifier */
  run_id: string;
  /** Project ID */
  project_id: string;
  /** Name of the test run */
  run_name: string;
  /** Test run status */
  status: TestRunStatus;
  /** Test run start time */
  started_at: string;
  /** Test run end time */
  ended_at?: string | null;
  /** Duration in seconds */
  duration_seconds?: number | null;
  /** Runner metadata */
  runner_metadata: Record<string, any>;
  /** Record creation time */
  created_at: string;
  /** Test run description */
  description?: string | null;
  /** Workflow metadata */
  workflow_metadata: Record<string, any>;
  /** Configuration snapshot */
  configuration_snapshot: Record<string, any>;
  /** Final metrics */
  final_metrics?: Record<string, any>;
  /** Coverage data */
  coverage_data?: Record<string, any>;
  /** Last update time */
  updated_at?: string | null;
  /** User who created */
  created_by?: Record<string, any>;
  /** Transitions */
  transitions?: Record<string, any>[] | null;
  /** Deficiencies */
  deficiencies?: Record<string, any>[] | null;
  /** Screenshots */
  screenshots?: Record<string, any>[] | null;
}

export interface TestRunListResponse {
  /** List of test runs */
  runs: TestRunResponse[];
  /** Pagination metadata */
  pagination: Pagination;
}

export interface TransitionResponse {
  /** Transition ID */
  transition_id: string;
  /** Sequence number */
  sequence_number: number;
  /** Source state */
  from_state: string;
  /** Destination state */
  to_state: string;
  /** Transition name */
  transition_name: string;
  /** Transition status */
  status: TransitionStatus;
  /** Duration in milliseconds */
  duration_ms: number;
  /** Start time */
  started_at: string;
  /** Completion time */
  completed_at: string;
  /** Error message */
  error_message?: string | null;
  /** Error type */
  error_type?: string | null;
}

export interface TransitionBatchResponse {
  /** Test run ID */
  run_id: string;
  /** Number recorded */
  transitions_recorded: number;
  /** IDs of created transitions */
  transition_ids: string[];
  /** Updated coverage */
  coverage_updated: Record<string, any>;
}

export interface DeficiencyResponse {
  /** Deficiency ID */
  deficiency_id: string;
  /** Test run ID */
  run_id: string;
  /** Deficiency title */
  title: string;
  /** Deficiency description */
  description: string;
  /** Severity level */
  severity: DeficiencySeverity;
  /** Deficiency status */
  status: DeficiencyStatus;
  /** Deficiency type */
  deficiency_type: DeficiencyType;
  /** State where occurred */
  state?: string | null;
  /** Related transition */
  transition_sequence_number?: number | null;
  /** Number of screenshots */
  screenshot_count?: number | null;
  /** Creation time */
  created_at: string;
  /** Last update time */
  updated_at: string;
  /** Related run info */
  run_info?: Record<string, any>;
}

export interface DeficiencyDetail {
  /** Deficiency ID */
  deficiency_id: string;
  /** Test run ID */
  run_id: string;
  /** Deficiency title */
  title: string;
  /** Deficiency description */
  description: string;
  /** Severity level */
  severity: DeficiencySeverity;
  /** Deficiency status */
  status: DeficiencyStatus;
  /** Deficiency type */
  deficiency_type: DeficiencyType;
  /** State where occurred */
  state?: string | null;
  /** Related transition */
  transition_sequence_number?: number | null;
  /** Number of screenshots */
  screenshot_count?: number | null;
  /** Creation time */
  created_at: string;
  /** Last update time */
  updated_at: string;
  /** Related run info */
  run_info?: Record<string, any>;
  /** Reproduction steps */
  reproduction_steps?: string[];
  /** Associated screenshots */
  screenshots?: any[];
  /** Additional metadata */
  metadata?: Record<string, any>;
  /** Assigned user */
  assigned_to?: Record<string, any>;
  /** Resolution notes */
  resolution_notes?: string | null;
  /** Comments */
  comments?: any[];
}

export interface DeficiencyListResponse {
  /** List of deficiencies */
  deficiencies: DeficiencyResponse[];
  /** Pagination metadata */
  pagination: Pagination;
  /** Summary statistics */
  summary: Record<string, any>;
}

export interface DeficiencyBatchResponse {
  /** Test run ID */
  run_id: string;
  /** Number recorded */
  deficiencies_recorded: number;
  /** IDs of created deficiencies */
  deficiency_ids: string[];
}

export interface CoverageUpdateResponse {
  /** Test run ID */
  run_id: string;
  /** Whether update succeeded */
  coverage_updated: boolean;
  /** Current coverage % */
  coverage_percentage: number;
  /** Unique transitions covered */
  unique_transitions_covered: number;
}

export interface TestRunCompleteResponse {
  /** Test run ID */
  run_id: string;
  /** Final status */
  status: TestRunStatus;
  /** Start time */
  started_at: string;
  /** End time */
  ended_at: string;
  /** Duration in seconds */
  duration_seconds: number;
  /** Final metrics */
  final_metrics: Record<string, any>;
}

export interface ScreenshotUploadResponse {
  /** Screenshot ID */
  screenshot_id: string;
  /** Test run ID */
  run_id: string;
  /** Full image URL */
  image_url: string;
  /** Thumbnail URL */
  thumbnail_url?: string | null;
  /** Upload time */
  uploaded_at: string;
  /** File size in bytes */
  file_size_bytes: number;
  /** State name */
  state_name?: string | null;
  /** Visual comparison result */
  visual_comparison?: VisualComparisonSummary | null;
}

export interface VisualComparisonSummary {
  /** Visual comparison result ID */
  comparison_id: string;
  /** Baseline ID compared against */
  baseline_id?: string | null;
  /** Similarity score (0.0-1.0) */
  similarity_score: number;
  /** Threshold used */
  threshold: number;
  /** Whether comparison passed */
  passed: boolean;
  /** Comparison status */
  status: string;
  /** Diff image URL */
  diff_image_url?: string | null;
  /** Number of diff regions */
  diff_region_count?: number;
}

export interface CoverageTrendDataPoint {
  /** Date (YYYY-MM-DD) */
  date: string;
  /** Number of runs on this date */
  runs_count: number;
  /** Average coverage % */
  avg_coverage_percentage: number;
  /** Maximum coverage % */
  max_coverage_percentage: number;
  /** Minimum coverage % */
  min_coverage_percentage: number;
  /** Total transitions */
  total_transitions_executed: number;
  /** Unique transitions */
  unique_transitions_covered: number;
}

export interface CoverageTrendResponse {
  /** Project ID */
  project_id: string;
  /** Start date */
  start_date: string;
  /** End date */
  end_date: string;
  /** Granularity */
  granularity: string;
  /** Trend data */
  data_points: CoverageTrendDataPoint[];
  /** Overall statistics */
  overall_stats: Record<string, any>;
}

export interface TransitionReliabilityStats {
  /** Transition name */
  transition_name: string;
  /** Source state */
  from_state: string;
  /** Destination state */
  to_state: string;
  /** Total executions */
  total_executions: number;
  /** Successful executions */
  successful_executions: number;
  /** Failed executions */
  failed_executions: number;
  /** Success rate % */
  success_rate: number;
  /** Average duration ms */
  avg_duration_ms: number;
  /** Median duration ms */
  median_duration_ms: number;
  /** 95th percentile duration */
  p95_duration_ms: number;
  /** Failure mode breakdown */
  failure_modes?: Record<string, any>[];
}

export interface ReliabilityResponse {
  /** Workflow ID */
  workflow_id: string;
  /** Workflow name */
  workflow_name?: string | null;
  /** Project ID */
  project_id: string;
  /** Date range */
  date_range: Record<string, any>;
  /** Transition statistics */
  transition_stats: TransitionReliabilityStats[];
  /** Overall metrics */
  overall_reliability: Record<string, any>;
}
