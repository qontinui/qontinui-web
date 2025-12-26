import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";

// Re-export generated types for use by other modules
export {
  TestRunStatus,
  TransitionStatus,
  DeficiencySeverity,
  DeficiencyStatus,
  DeficiencyType,
  ScreenshotType,
} from "@/types/generated/testing";

export type {
  Pagination,
  TestRunListResponse as TestRunListResponseGenerated,
} from "@/types/generated/testing";

// Import generated types for internal use
import type { TestRunResponse as TestRunResponseGenerated } from "@/types/generated/testing";

/**
 * Backend response shape for test runs (matches backend TestRunResponse schema)
 * Uses generated type from qontinui-schemas
 */
type TestRunBackend = TestRunResponseGenerated;

export interface TestRun {
  id: string;
  project_id: string;
  workflow_id: string;
  workflow_name: string;
  status: "running" | "completed" | "failed";
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  total_transitions: number;
  successful_transitions: number;
  failed_transitions: number;
  coverage_percentage: number;
  states_covered: number;
  total_states: number;
  deficiencies_found: number;
  runner_id: string;
  created_at: string;
  updated_at: string;
}

export interface TestRunDetail extends TestRun {
  transitions: TransitionResult[];
  deficiencies: Deficiency[];
  state_coverage: StateCoverage[];
}

export interface TransitionResult {
  id: string;
  test_run_id: string;
  from_state: string;
  to_state: string;
  action_type: string;
  success: boolean;
  duration_ms: number;
  error_message: string | null;
  screenshot_url: string | null;
  executed_at: string;
}

export interface Deficiency {
  id: string;
  test_run_id: string;
  project_id: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "open" | "in_progress" | "resolved" | "wont_fix";
  title: string;
  description: string;
  state_name: string;
  transition_from: string | null;
  transition_to: string | null;
  error_message: string | null;
  screenshot_url: string | null;
  reproduction_steps: string[];
  expected_behavior: string;
  actual_behavior: string;
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StateCoverage {
  state_name: string;
  times_visited: number;
  successful_visits: number;
  failed_visits: number;
  average_duration_ms: number;
}

export interface CoverageTrend {
  date: string;
  coverage_percentage: number;
  states_covered: number;
  total_states: number;
  test_run_count: number;
}

export interface ReliabilityStats {
  overall_success_rate: number;
  total_transitions_tested: number;
  successful_transitions: number;
  failed_transitions: number;
  average_transition_time_ms: number;
  most_reliable_transitions: TransitionReliability[];
  least_reliable_transitions: TransitionReliability[];
  state_reliability: StateReliability[];
}

export interface TransitionReliability {
  from_state: string;
  to_state: string;
  action_type: string;
  success_rate: number;
  total_attempts: number;
  average_duration_ms: number;
}

export interface StateReliability {
  state_name: string;
  visit_count: number;
  success_rate: number;
  average_duration_ms: number;
}

export interface StateGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  label: string;
  visit_count: number;
  success_rate: number;
  type: "start" | "end" | "normal";
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  success_rate: number;
  attempt_count: number;
}

export interface TestRunFilters {
  project_id?: string;
  workflow_id?: string;
  status?: TestRun["status"];
  start_date?: string;
  end_date?: string;
  min_coverage?: number;
  max_coverage?: number;
  page?: number;
  page_size?: number;
  sort_by?: "created_at" | "coverage_percentage" | "duration_seconds";
  sort_order?: "asc" | "desc";
}

export interface DeficiencyFilters {
  project_id?: string;
  test_run_id?: string;
  severity?: Deficiency["severity"];
  status?: Deficiency["status"];
  search?: string;
  page?: number;
  page_size?: number;
  sort_by?: "created_at" | "severity" | "status";
  sort_order?: "asc" | "desc";
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface TransitionComparison {
  from_state: string;
  to_state: string;
  status: "passed" | "failed" | "new" | "fixed";
  run1_success: boolean;
  run2_success: boolean;
  run1_error?: string | null;
  run2_error?: string | null;
  error?: string | null;
}

export interface CoverageDiff {
  percentage_change: number;
  states_gained: number;
  transitions_gained: number;
}

export interface DeficienciesDiff {
  new_count: number;
  resolved_count: number;
}

export interface ExecutionTimeDiff {
  seconds_change: number;
  percentage_change: number;
}

export interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  change_percentage: number;
  pixel_count?: number;
}

export interface TestRunComparisonData {
  run1: TestRun;
  run2: TestRun;
  comparison: {
    coverage_diff: CoverageDiff;
    deficiencies_diff: DeficienciesDiff;
    execution_time_diff: ExecutionTimeDiff;
    regressions: TransitionComparison[];
    fixed: TransitionComparison[];
    new_failures: TransitionComparison[];
    unchanged_count: number;
  };
}

/**
 * Visual regression types
 */
export type VisualComparisonStatus =
  | "passed"
  | "failed"
  | "pending_review"
  | "approved_as_new"
  | "no_baseline";

/**
 * Summary of visual comparison result returned from screenshot upload
 */
export interface VisualComparisonSummary {
  comparison_id: string;
  baseline_id: string | null;
  similarity_score: number;
  threshold: number;
  passed: boolean;
  status: VisualComparisonStatus;
  diff_image_url: string | null;
  diff_region_count: number;
}

/**
 * Response from screenshot upload endpoint
 */
export interface ScreenshotUploadResponse {
  screenshot_id: string;
  run_id: string;
  image_url: string;
  thumbnail_url: string | null;
  uploaded_at: string;
  file_size_bytes: number;
  state_name: string | null;
  visual_comparison: VisualComparisonSummary | null;
}

/**
 * Service for managing testing history and results
 */
export class TestingService {
  constructor(private httpClient: HttpClient) {}

  /**
   * Fetch test runs with optional filters
   */
  async getTestRuns(
    filters?: TestRunFilters
  ): Promise<PaginatedResponse<TestRun>> {
    const params = new URLSearchParams();

    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
    }

    const queryString = params.toString();
    const url = `/api/v1/testing/runs${queryString ? `?${queryString}` : ""}`;

    // Backend returns: { runs: [...], pagination: { total, limit, offset, has_more } }
    // Frontend expects: { items: [...], total, page, page_size, total_pages }
    const response = await this.httpClient.get<{
      runs: TestRunBackend[];
      pagination: {
        total: number;
        limit: number;
        offset: number;
        has_more: boolean;
      };
    }>(url);

    const page = Math.floor(response.pagination.offset / response.pagination.limit) + 1;
    const total_pages = Math.ceil(response.pagination.total / response.pagination.limit);

    // Transform backend response to frontend format
    const items: TestRun[] = response.runs.map((run) => ({
      id: run.run_id,
      project_id: run.project_id,
      workflow_id: run.runner_metadata?.workflow_id || "",
      workflow_name: run.run_name,
      status: run.status as "running" | "completed" | "failed",
      start_time: run.started_at,
      end_time: run.ended_at ?? null,
      duration_seconds: run.duration_seconds ?? null,
      total_transitions: run.runner_metadata?.total_transitions || 0,
      successful_transitions: run.runner_metadata?.successful_transitions || 0,
      failed_transitions: run.runner_metadata?.failed_transitions || 0,
      coverage_percentage: run.runner_metadata?.coverage_percentage || 0,
      states_covered: run.runner_metadata?.states_covered || 0,
      total_states: run.runner_metadata?.total_states || 0,
      deficiencies_found: run.runner_metadata?.deficiencies_found || 0,
      runner_id: run.runner_metadata?.runner_id || "",
      created_at: run.created_at,
      updated_at: run.created_at,
    }));

    return {
      items,
      total: response.pagination.total,
      page,
      page_size: response.pagination.limit,
      total_pages,
    };
  }

  /**
   * Fetch a single test run with full details
   */
  async getTestRun(id: string): Promise<TestRunDetail> {
    return this.httpClient.get<TestRunDetail>(`/api/v1/testing/runs/${id}`);
  }

  /**
   * Fetch deficiencies with optional filters
   */
  async getDeficiencies(
    filters?: DeficiencyFilters
  ): Promise<PaginatedResponse<Deficiency>> {
    const params = new URLSearchParams();

    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
    }

    const queryString = params.toString();
    const url = `/api/v1/testing/deficiencies${queryString ? `?${queryString}` : ""}`;

    return this.httpClient.get<PaginatedResponse<Deficiency>>(url);
  }

  /**
   * Update a deficiency
   */
  async updateDeficiency(
    id: string,
    data: Partial<Deficiency>
  ): Promise<Deficiency> {
    return this.httpClient.patch<Deficiency>(
      `/api/v1/testing/deficiencies/${id}`,
      data
    );
  }

  /**
   * Fetch coverage trends over time
   */
  async getCoverageTrends(
    projectId: string,
    startDate?: string,
    endDate?: string
  ): Promise<CoverageTrend[]> {
    const params = new URLSearchParams({ project_id: projectId });

    if (startDate) params.append("start_date", startDate);
    if (endDate) params.append("end_date", endDate);

    const queryString = params.toString();
    const url = `/api/v1/testing/coverage-trends${queryString ? `?${queryString}` : ""}`;

    // Backend returns CoverageTrendResponse with data_points array
    // Transform to frontend's expected CoverageTrend[] format
    const response = await this.httpClient.get<{
      project_id: string;
      start_date: string;
      end_date: string;
      granularity: string;
      data_points: Array<{
        date: string;
        runs_count: number;
        avg_coverage_percentage: number;
        max_coverage_percentage: number;
        min_coverage_percentage: number;
        total_transitions_executed: number;
        unique_transitions_covered: number;
      }>;
      overall_stats: Record<string, unknown>;
    }>(url);

    // Transform backend data points to frontend format
    return response.data_points.map((dp) => ({
      date: dp.date,
      coverage_percentage: dp.avg_coverage_percentage,
      states_covered: dp.unique_transitions_covered,
      total_states: dp.total_transitions_executed,
      test_run_count: dp.runs_count,
    }));
  }

  /**
   * Fetch reliability statistics
   */
  async getReliabilityStats(
    projectId: string,
    workflowId?: string
  ): Promise<ReliabilityStats> {
    const params = new URLSearchParams({ project_id: projectId });

    if (workflowId) params.append("workflow_id", workflowId);

    const queryString = params.toString();
    const url = `/api/v1/testing/reliability-stats${queryString ? `?${queryString}` : ""}`;

    // Backend returns ReliabilityResponse with different structure
    // Transform to frontend's expected ReliabilityStats format
    const response = await this.httpClient.get<{
      workflow_id: string;
      workflow_name: string | null;
      project_id: string;
      date_range: { start: string; end: string };
      transition_stats: Array<{
        transition_name: string;
        from_state: string;
        to_state: string;
        total_executions: number;
        successful_executions: number;
        failed_executions: number;
        success_rate: number;
        avg_duration_ms: number;
        median_duration_ms: number;
        p95_duration_ms: number;
        failure_modes: Array<{
          error_type: string;
          count: number;
          percentage: number;
        }>;
      }>;
      overall_reliability: {
        total_transitions_analyzed: number;
        avg_success_rate: number;
        most_reliable_transition: string | null;
        least_reliable_transition: string | null;
      };
    }>(url);

    // Calculate aggregated stats from transition_stats
    const totalTransitions = response.transition_stats.reduce(
      (sum, t) => sum + t.total_executions,
      0
    );
    const successfulTransitions = response.transition_stats.reduce(
      (sum, t) => sum + t.successful_executions,
      0
    );
    const failedTransitions = response.transition_stats.reduce(
      (sum, t) => sum + t.failed_executions,
      0
    );
    const avgDuration =
      response.transition_stats.length > 0
        ? response.transition_stats.reduce((sum, t) => sum + t.avg_duration_ms, 0) /
          response.transition_stats.length
        : 0;

    // Sort transitions by success rate
    const sortedBySuccess = [...response.transition_stats].sort(
      (a, b) => b.success_rate - a.success_rate
    );

    // Transform to frontend format
    const transformTransition = (t: (typeof response.transition_stats)[0]): TransitionReliability => ({
      from_state: t.from_state,
      to_state: t.to_state,
      action_type: t.transition_name,
      success_rate: t.success_rate,
      total_attempts: t.total_executions,
      average_duration_ms: t.avg_duration_ms,
    });

    return {
      overall_success_rate: response.overall_reliability.avg_success_rate,
      total_transitions_tested: totalTransitions,
      successful_transitions: successfulTransitions,
      failed_transitions: failedTransitions,
      average_transition_time_ms: avgDuration,
      most_reliable_transitions: sortedBySuccess.slice(0, 5).map(transformTransition),
      least_reliable_transitions: sortedBySuccess.slice(-5).reverse().map(transformTransition),
      state_reliability: [], // Backend doesn't provide per-state reliability directly
    };
  }

  /**
   * Fetch state graph data for visualization
   */
  async getStateGraph(
    projectId: string,
    workflowId: string
  ): Promise<StateGraphData> {
    const params = new URLSearchParams({
      project_id: projectId,
      workflow_id: workflowId,
    });

    const queryString = params.toString();
    const url = `/api/v1/testing/state-graph${queryString ? `?${queryString}` : ""}`;

    return this.httpClient.get<StateGraphData>(url);
  }

  /**
   * Export test run data
   */
  async exportTestRun(
    id: string,
    format: "json" | "csv" | "pdf"
  ): Promise<Blob> {
    const response = await fetch(
      `${ApiConfig.getBaseUrl()}/api/v1/testing/runs/${id}/export?format=${format}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.httpClient.getAuthToken()}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`);
    }

    return response.blob();
  }

  /**
   * Export deficiencies data
   */
  async exportDeficiencies(
    filters: DeficiencyFilters,
    format: "json" | "csv"
  ): Promise<Blob> {
    const params = new URLSearchParams();

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });

    params.append("format", format);

    const queryString = params.toString();
    const url = `${ApiConfig.getBaseUrl()}/api/v1/testing/deficiencies/export${queryString ? `?${queryString}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.httpClient.getAuthToken()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`);
    }

    return response.blob();
  }

  /**
   * Compare two test runs
   */
  async compareTestRuns(
    run1Id: string,
    run2Id: string
  ): Promise<TestRunComparisonData> {
    const params = new URLSearchParams({
      run1_id: run1Id,
      run2_id: run2Id,
    });

    const queryString = params.toString();
    const url = `/api/v1/testing/runs/compare${queryString ? `?${queryString}` : ""}`;

    return this.httpClient.get<TestRunComparisonData>(url);
  }
}
