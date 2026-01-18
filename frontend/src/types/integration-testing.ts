// types/integration-testing.ts
// Types for Integration Testing feature (mock mode testing with historical data)

export interface MockExecutionRequest {
  project_id: string;
  workflow_id: string;
  workflow_name: string;
  snapshot_run_ids: string[];
  initial_states: string[];
  actions: ActionSpec[];
}

export interface ActionSpec {
  type: string;
  pattern_id?: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface MockExecutionResponse {
  workflow_id: string;
  workflow_name: string;
  start_time: string;
  end_time: string | null;
  total_duration_ms: number;
  initial_states: string[];
  final_states: string[];
  actions: ActionVisualization[];
  success: boolean;
  success_rate: number;
  total_actions: number;
  successful_actions: number;
}

export interface ActionVisualization {
  action_type: string;
  screenshot_path: string;
  action_location?: [number, number];
  action_region?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  success: boolean;
  matches?: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    score: number;
  }>;
  text?: string;
  active_states: string[];
  timestamp: string;
  duration_ms: number;
}

export interface StateScreenshot {
  screenshot_path: string;
  active_states: string[];
  timestamp: string;
  width: number;
  height: number;
  state_hash: string;
}

export interface StateScreenshotListResponse {
  screenshots: StateScreenshot[];
  total: number;
  unique_state_combinations: number;
}

export interface CoverageAnalysisRequest {
  workflow_id: string;
  workflow_name: string;
  snapshot_run_ids: string[];
  expected_states?: string[];
}

export interface StateCoverageMetrics {
  state_name: string;
  screenshot_count: number;
  actions_performed: number;
  last_tested: string | null;
  coverage_percentage: number;
  transitions_to: string[];
  transitions_from: string[];
  action_types: string[];
  patterns_tested: string[];
}

export interface StateTransition {
  from_state: string;
  to_state: string;
  count: number;
  covered: boolean;
  last_occurrence: string | null;
  actions_triggering: string[];
}

export interface CoverageGap {
  gap_type: string;
  severity: "high" | "medium" | "low";
  description: string;
  recommendation: string;
  affected_states: string[];
  metric_value?: number;
}

export interface CoverageReport {
  workflow_id: string;
  workflow_name: string;
  snapshot_run_ids: string[];
  analysis_time: string;
  overall_coverage_percentage: number;
  total_states: number;
  covered_states: number;
  uncovered_states: number;
  total_transitions: number;
  covered_transitions: number;
  missing_transitions: number;
  state_metrics: Record<string, StateCoverageMetrics>;
  transitions: StateTransition[];
  coverage_gaps: CoverageGap[];
  recommendations: string[];
}

// =============================================================================
// Integration Test Run Types (for step-by-step execution display)
// =============================================================================

/**
 * Full integration test run result with detailed execution steps
 */
export interface IntegrationTestRun {
  id: string;
  workflow_id: string;
  workflow_name: string;
  run_type: "integration_test";
  status: "pending" | "running" | "completed" | "failed";
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  initial_states: string[];
  final_states: string[];
  steps: ExecutionStep[];
  coverage_data: CoverageData;
  stochasticity_warnings: StochasticityWarning[];
  coverage_gaps: CoverageGap[];
  reliability_insights: ReliabilityInsight[];
}

/**
 * Coverage data summary for the test run
 */
export interface CoverageData {
  states_covered: number;
  total_states: number;
  transitions_covered: number;
  total_transitions: number;
  coverage_percentage: number;
}

/**
 * Union type for all execution step types
 */
export type ExecutionStep =
  | StateDiscoveryStep
  | PathCalculationStep
  | ActionStep
  | StateUpdateStep;

/**
 * Base step properties shared by all step types
 */
export interface BaseExecutionStep {
  step_number: number;
  timestamp: string;
  duration_ms: number;
}

/**
 * State discovery step - initial state detection
 */
export interface StateDiscoveryStep extends BaseExecutionStep {
  type: "state_discovery";
  active_states: string[];
  initial_states_match: boolean;
  expected_initial_states: string[];
  detection_method: "visual" | "historical" | "mock";
}

/**
 * Path calculation step - route planning to target state
 */
export interface PathCalculationStep extends BaseExecutionStep {
  type: "path_calculation";
  target_state: string;
  current_states: string[];
  available_paths: CalculatedPath[];
  selected_path: CalculatedPath | null;
  selection_reason: string;
  no_path_found: boolean;
}

/**
 * A calculated path with cost and route info
 */
export interface CalculatedPath {
  path_id: string;
  states: string[];
  transitions: string[];
  total_cost: number;
  estimated_duration_ms: number;
  reliability_score: number;
}

/**
 * Action execution step
 */
export interface ActionStep extends BaseExecutionStep {
  type: "action";
  action_id: string;
  action_type: ActionType;
  action_name: string;
  pattern_id?: string;
  pattern_name?: string;
  target_state?: string;
  from_states: string[];
  to_states: string[];
  result: ActionResult;
  historical_stats: HistoricalActionStats | null;
  stochastic_notes: string[];
  screenshot_url?: string;
  match_location?: MatchLocation;
  input_data?: ActionInputData;
}

/**
 * Types of actions that can be executed
 */
export type ActionType =
  | "find"
  | "click"
  | "type"
  | "drag"
  | "scroll"
  | "wait"
  | "assert"
  | "screenshot"
  | "custom";

/**
 * Result of an action execution
 */
export interface ActionResult {
  success: boolean;
  error_message?: string;
  match_count?: number;
  best_match_score?: number;
  actual_duration_ms: number;
  retries: number;
}

/**
 * Historical statistics for an action/pattern combination
 */
export interface HistoricalActionStats {
  record_count: number;
  success_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  failure_reasons: FailureReason[];
  state_contexts: string[];
}

/**
 * Failure reason with occurrence count
 */
export interface FailureReason {
  reason: string;
  count: number;
  percentage: number;
}

/**
 * Location of a match on screen
 */
export interface MatchLocation {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

/**
 * Input data for actions (type, drag, etc.)
 */
export interface ActionInputData {
  text?: string;
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  keys?: string[];
  scroll_delta?: { x: number; y: number };
}

/**
 * State update step - state machine transitions
 */
export interface StateUpdateStep extends BaseExecutionStep {
  type: "state_update";
  activated_states: string[];
  deactivated_states: string[];
  new_active_states: string[];
  trigger_action_id?: string;
}

/**
 * Warning about stochastic behavior detected in historical data
 */
export interface StochasticityWarning {
  id: string;
  severity: "high" | "medium" | "low";
  pattern_id?: string;
  pattern_name?: string;
  action_type?: ActionType;
  state_context: string[];
  warning_type: StochasticityWarningType;
  description: string;
  recommendation: string;
  historical_failure_rate: number;
  sample_failures: SampleFailure[];
}

/**
 * Types of stochasticity warnings
 */
export type StochasticityWarningType =
  | "high_failure_rate"
  | "inconsistent_timing"
  | "flaky_match"
  | "state_dependent_failure"
  | "intermittent_element";

/**
 * Sample failure from historical data
 */
export interface SampleFailure {
  timestamp: string;
  error_message: string;
  active_states: string[];
}

/**
 * Reliability insight derived from historical data analysis
 */
export interface ReliabilityInsight {
  id: string;
  insight_type: ReliabilityInsightType;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  affected_patterns: string[];
  affected_states: string[];
  metric_value?: number;
  metric_threshold?: number;
  recommendation: string;
}

/**
 * Types of reliability insights
 */
export type ReliabilityInsightType =
  | "low_success_rate"
  | "high_latency"
  | "unreliable_transition"
  | "coverage_gap"
  | "dead_end_state"
  | "orphan_state"
  | "bottleneck_transition";

// =============================================================================
// Visual Playback Types
// =============================================================================

/**
 * Playback state for visual mode
 */
export interface PlaybackState {
  is_playing: boolean;
  current_step_index: number;
  playback_speed: number; // multiplier: 0.5, 1, 2, 4
  total_steps: number;
}

/**
 * Frame data for visual playback
 */
export interface PlaybackFrame {
  step_index: number;
  step_type: ExecutionStep["type"];
  screenshot_url: string | null;
  active_states: string[];
  timestamp: string;
  action_animation?: ActionAnimation;
  highlight_regions: HighlightRegion[];
}

/**
 * Animation data for action visualization
 */
export interface ActionAnimation {
  animation_type:
    | "click_ripple"
    | "type_indicator"
    | "drag_path"
    | "scroll_indicator";
  start_position?: { x: number; y: number };
  end_position?: { x: number; y: number };
  text?: string;
  duration_ms: number;
}

/**
 * Region to highlight on screenshot
 */
export interface HighlightRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  color?: string;
  style?: "solid" | "dashed" | "pulse";
}

// =============================================================================
// API Request/Response Types for Integration Test Endpoint
// =============================================================================

/**
 * Request to run an integration test via runner
 */
export interface IntegrationTestRequest {
  project_id: string;
  workflow_config: WorkflowConfig;
  initial_states?: string[];
  options?: IntegrationTestOptions;
}

/**
 * Workflow configuration for integration test
 */
export interface WorkflowConfig {
  workflow_id: string;
  workflow_name: string;
  states: StateConfig[];
  transitions: TransitionConfig[];
  initial_state_ids?: string[];
}

/**
 * State configuration
 */
export interface StateConfig {
  id: string;
  name: string;
  patterns?: string[];
  is_initial?: boolean;
}

/**
 * Transition configuration
 */
export interface TransitionConfig {
  id: string;
  name: string;
  from_state_id: string;
  to_state_id: string;
  actions?: ActionConfig[];
}

/**
 * Action configuration
 */
export interface ActionConfig {
  id: string;
  type: string;
  pattern_id?: string;
  config?: Record<string, unknown>;
}

/**
 * Options for integration test execution
 */
export interface IntegrationTestOptions {
  max_steps?: number;
  timeout_ms?: number;
  record_screenshots?: boolean;
  include_historical_stats?: boolean;
}

/**
 * Response from integration test execution
 */
export interface IntegrationTestResponse {
  run_id: string;
  project_id: string;
  workflow_id: string;
  workflow_name: string;
  status: "completed" | "failed" | "timeout";
  started_at: string;
  ended_at: string;
  duration_ms: number;
  initial_states: string[];
  final_states: string[];
  steps: ExecutionStep[];
  coverage_data: CoverageData;
  stochasticity_warnings: StochasticityWarning[];
  coverage_gaps: CoverageGap[];
  reliability_insights: ReliabilityInsight[];
  summary: IntegrationTestSummary;
}

/**
 * Summary statistics for the integration test
 */
export interface IntegrationTestSummary {
  total_steps: number;
  total_actions: number;
  successful_actions: number;
  failed_actions: number;
  states_visited: number;
  transitions_executed: number;
  avg_action_duration_ms: number;
  low_confidence_actions: number;
}

/**
 * List response for integration test runs
 */
export interface IntegrationTestRunListResponse {
  runs: IntegrationTestRunSummary[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

/**
 * Summary of an integration test run for list display
 */
export interface IntegrationTestRunSummary {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: "pending" | "running" | "completed" | "failed" | "timeout";
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  coverage_percentage: number;
  success_rate: number;
  total_actions: number;
  issues_count: number;
}
