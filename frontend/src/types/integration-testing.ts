// types/integration-testing.ts

export interface MockExecutionRequest {
  process_id: string;
  process_name: string;
  snapshot_run_ids: string[]; // Support multiple snapshot runs
  snapshot_run_id?: string; // Deprecated: for backward compatibility
  initial_states: string[];
  actions: ActionSpec[];
}

export interface ActionSpec {
  type: string; // "FIND" | "CLICK" | "TYPE" | etc.
  pattern_id?: string;
  text?: string;
  metadata?: Record<string, any>;
}

export interface MockExecutionResponse {
  process_id: string;
  process_name: string;
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

// Coverage Analysis Types

export interface CoverageAnalysisRequest {
  process_id: string;
  process_name: string;
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
  severity: 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
  affected_states: string[];
  metric_value?: number;
}

export interface CoverageReport {
  process_id: string;
  process_name: string;
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
