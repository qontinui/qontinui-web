import { HttpClient } from "./http-client";

// Re-export types for backward compatibility
// These now map to the unified execution types
export type TestRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled";
export type TransitionStatus =
  | "success"
  | "failed"
  | "timeout"
  | "skipped"
  | "error";
export type DeficiencySeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";
export type DeficiencyStatus = "open" | "in_progress" | "resolved" | "wont_fix";
export type DeficiencyType =
  | "functional"
  | "visual"
  | "performance"
  | "crash"
  | "timeout"
  | "assertion"
  | "state_mismatch"
  | "element_not_found"
  | "other";
export type ScreenshotType =
  | "state_verification"
  | "before_action"
  | "after_action"
  | "on_error"
  | "on_success"
  | "manual";

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/**
 * Backend response shape for execution runs (unified execution API)
 * Maps to the new execution schema
 */
interface ExecutionRunBackend {
  id: string;
  project_id: string;
  run_type: string;
  run_name: string;
  status: string;
  started_at: string;
  ended_at?: string;
  duration_seconds?: number;
  runner_metadata: {
    runner_version: string;
    os: string;
    hostname: string;
    workflow_id?: string;
    total_transitions?: number;
    successful_transitions?: number;
    failed_transitions?: number;
    coverage_percentage?: number;
    states_covered?: number;
    total_states?: number;
    deficiencies_found?: number;
    runner_id?: string;
  };
  workflow_metadata?: {
    workflow_id: string;
    workflow_name: string;
  };
  stats?: {
    total_actions: number;
    successful_actions: number;
    failed_actions: number;
    total_issues: number;
  };
  coverage_data?: {
    coverage_percentage: number;
    states_covered: number;
    states_total: number;
  };
  created_at: string;
}

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
   * Now calls the unified execution API
   */
  async getTestRuns(
    filters?: TestRunFilters
  ): Promise<PaginatedResponse<TestRun>> {
    const params = new URLSearchParams();

    if (filters) {
      // Map test run filters to execution filters
      if (filters.project_id) params.append("project_id", filters.project_id);
      if (filters.workflow_id)
        params.append("workflow_id", filters.workflow_id);
      if (filters.status) params.append("status", filters.status);
      if (filters.start_date) params.append("start_date", filters.start_date);
      if (filters.end_date) params.append("end_date", filters.end_date);
      if (filters.page !== undefined) {
        const limit = filters.page_size || 20;
        params.append("limit", String(limit));
        params.append("offset", String((filters.page - 1) * limit));
      }
      if (filters.page_size) params.append("limit", String(filters.page_size));
      // Add run_type filter for qa_test to get test runs specifically
      params.append("run_type", "qa_test");
    }

    const queryString = params.toString();
    // Use the new unified execution API
    const url = `/api/v1/execution/runs${queryString ? `?${queryString}` : ""}`;

    // Backend returns: { runs: [...], pagination: { total, limit, offset, has_more } }
    // Frontend expects: { items: [...], total, page, page_size, total_pages }
    const response = await this.httpClient.get<{
      runs: ExecutionRunBackend[];
      pagination: {
        total: number;
        limit: number;
        offset: number;
        has_more: boolean;
      };
    }>(url);

    const limit = response.pagination.limit || 20;
    const page = Math.floor(response.pagination.offset / limit) + 1;
    const total_pages = Math.ceil(response.pagination.total / limit);

    // Transform execution runs to test run format for backward compatibility
    const items: TestRun[] = response.runs.map((run) => ({
      id: run.id,
      project_id: run.project_id,
      workflow_id:
        run.workflow_metadata?.workflow_id ||
        run.runner_metadata?.workflow_id ||
        "",
      workflow_name: run.workflow_metadata?.workflow_name || run.run_name,
      status: this.mapExecutionStatusToTestStatus(run.status),
      start_time: run.started_at,
      end_time: run.ended_at ?? null,
      duration_seconds: run.duration_seconds ?? null,
      total_transitions:
        run.stats?.total_actions || run.runner_metadata?.total_transitions || 0,
      successful_transitions:
        run.stats?.successful_actions ||
        run.runner_metadata?.successful_transitions ||
        0,
      failed_transitions:
        run.stats?.failed_actions ||
        run.runner_metadata?.failed_transitions ||
        0,
      coverage_percentage:
        run.coverage_data?.coverage_percentage ||
        run.runner_metadata?.coverage_percentage ||
        0,
      states_covered:
        run.coverage_data?.states_covered ||
        run.runner_metadata?.states_covered ||
        0,
      total_states:
        run.coverage_data?.states_total ||
        run.runner_metadata?.total_states ||
        0,
      deficiencies_found:
        run.stats?.total_issues || run.runner_metadata?.deficiencies_found || 0,
      runner_id: run.runner_metadata?.runner_id || "",
      created_at: run.created_at,
      updated_at: run.created_at,
    }));

    return {
      items,
      total: response.pagination.total,
      page,
      page_size: limit,
      total_pages,
    };
  }

  /**
   * Map execution status to test run status for backward compatibility
   */
  private mapExecutionStatusToTestStatus(
    status: string
  ): "running" | "completed" | "failed" {
    switch (status) {
      case "completed":
        return "completed";
      case "failed":
      case "timeout":
      case "cancelled":
        return "failed";
      case "pending":
      case "running":
      case "paused":
      default:
        return "running";
    }
  }

  /**
   * Fetch a single test run with full details
   * Now calls the unified execution API
   */
  async getTestRun(id: string): Promise<TestRunDetail> {
    // Fetch the execution run
    const run = await this.httpClient.get<
      ExecutionRunBackend & {
        description?: string;
        configuration?: Record<string, unknown>;
      }
    >(`/api/v1/execution/runs/${id}`);

    // Fetch actions for transition results
    const actionsResponse = await this.httpClient.get<{
      actions: Array<{
        id: string;
        run_id: string;
        sequence_number: number;
        action_type: string;
        action_name: string;
        status: string;
        started_at: string;
        completed_at: string;
        duration_ms: number;
        from_state?: string;
        to_state?: string;
        error_message?: string;
        screenshot_id?: string;
      }>;
      pagination: Pagination;
    }>(`/api/v1/execution/runs/${id}/actions?limit=1000`);

    // Fetch issues for deficiencies
    const issuesResponse = await this.httpClient.get<{
      issues: Array<{
        id: string;
        run_id: string;
        issue_type: string;
        severity: string;
        status: string;
        source: string;
        title: string;
        description: string;
        state_name?: string;
        action_sequence_number?: number;
        reproduction_steps?: string[];
        created_at: string;
        updated_at: string;
      }>;
      pagination: Pagination;
    }>(`/api/v1/execution/runs/${id}/issues?limit=1000`);

    // Transform to TestRunDetail format
    const transitions: TransitionResult[] = actionsResponse.actions.map(
      (action) => ({
        id: action.id,
        test_run_id: action.run_id,
        from_state: action.from_state || "",
        to_state: action.to_state || "",
        action_type: action.action_type,
        success: action.status === "success",
        duration_ms: action.duration_ms,
        error_message: action.error_message || null,
        screenshot_url: action.screenshot_id
          ? `/api/v1/execution/screenshots/${action.screenshot_id}`
          : null,
        executed_at: action.started_at,
      })
    );

    const deficiencies: Deficiency[] = issuesResponse.issues.map((issue) => ({
      id: issue.id,
      test_run_id: issue.run_id,
      project_id: run.project_id,
      severity: issue.severity as "critical" | "high" | "medium" | "low",
      status: issue.status as "open" | "in_progress" | "resolved" | "wont_fix",
      title: issue.title,
      description: issue.description,
      state_name: issue.state_name || "",
      transition_from: null,
      transition_to: null,
      error_message: null,
      screenshot_url: null,
      reproduction_steps: issue.reproduction_steps || [],
      expected_behavior: "",
      actual_behavior: "",
      assigned_to: null,
      resolved_at: null,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
    }));

    // Build state coverage from actions
    const stateVisits: Record<
      string,
      { total: number; success: number; failed: number; duration: number }
    > = {};
    for (const action of actionsResponse.actions) {
      if (action.to_state) {
        const stateName = action.to_state;
        if (!stateVisits[stateName]) {
          stateVisits[stateName] = {
            total: 0,
            success: 0,
            failed: 0,
            duration: 0,
          };
        }
        const stats = stateVisits[stateName];
        stats.total++;
        stats.duration += action.duration_ms;
        if (action.status === "success") {
          stats.success++;
        } else {
          stats.failed++;
        }
      }
    }

    const state_coverage: StateCoverage[] = Object.entries(stateVisits).map(
      ([stateName, stats]) => ({
        state_name: stateName,
        times_visited: stats.total,
        successful_visits: stats.success,
        failed_visits: stats.failed,
        average_duration_ms:
          stats.total > 0 ? Math.round(stats.duration / stats.total) : 0,
      })
    );

    return {
      id: run.id,
      project_id: run.project_id,
      workflow_id:
        run.workflow_metadata?.workflow_id ||
        run.runner_metadata?.workflow_id ||
        "",
      workflow_name: run.workflow_metadata?.workflow_name || run.run_name,
      status: this.mapExecutionStatusToTestStatus(run.status),
      start_time: run.started_at,
      end_time: run.ended_at ?? null,
      duration_seconds: run.duration_seconds ?? null,
      total_transitions:
        run.stats?.total_actions || actionsResponse.actions.length,
      successful_transitions:
        run.stats?.successful_actions ||
        actionsResponse.actions.filter((a) => a.status === "success").length,
      failed_transitions:
        run.stats?.failed_actions ||
        actionsResponse.actions.filter((a) => a.status !== "success").length,
      coverage_percentage: run.coverage_data?.coverage_percentage || 0,
      states_covered:
        run.coverage_data?.states_covered || Object.keys(stateVisits).length,
      total_states:
        run.coverage_data?.states_total || Object.keys(stateVisits).length,
      deficiencies_found:
        run.stats?.total_issues || issuesResponse.issues.length,
      runner_id: run.runner_metadata?.runner_id || "",
      created_at: run.created_at,
      updated_at: run.created_at,
      transitions,
      deficiencies,
      state_coverage,
    };
  }

  /**
   * Fetch deficiencies with optional filters
   * Now calls the unified execution issues API
   */
  async getDeficiencies(
    filters?: DeficiencyFilters
  ): Promise<PaginatedResponse<Deficiency>> {
    const params = new URLSearchParams();

    if (filters) {
      // Map deficiency filters to execution issue filters
      if (filters.project_id) params.append("project_id", filters.project_id);
      if (filters.test_run_id) params.append("run_id", filters.test_run_id);
      if (filters.severity) params.append("severity", filters.severity);
      if (filters.status) params.append("status", filters.status);
      if (filters.page !== undefined) {
        const limit = filters.page_size || 20;
        params.append("limit", String(limit));
        params.append("offset", String((filters.page - 1) * limit));
      }
      if (filters.page_size) params.append("limit", String(filters.page_size));
    }

    const queryString = params.toString();
    // Use the new unified execution issues API
    const url = `/api/v1/execution/issues${queryString ? `?${queryString}` : ""}`;

    const response = await this.httpClient.get<{
      issues: Array<{
        id: string;
        run_id: string;
        issue_type: string;
        severity: string;
        status: string;
        source: string;
        title: string;
        description: string;
        state_name?: string;
        action_sequence_number?: number;
        reproduction_steps?: string[];
        created_at: string;
        updated_at: string;
      }>;
      pagination: Pagination;
      summary?: {
        by_severity: Record<string, number>;
        by_status: Record<string, number>;
        by_type: Record<string, number>;
      };
    }>(url);

    const limit = response.pagination.limit || 20;
    const page = Math.floor(response.pagination.offset / limit) + 1;
    const total_pages = Math.ceil(response.pagination.total / limit);

    // Transform execution issues to deficiencies for backward compatibility
    const items: Deficiency[] = response.issues.map((issue) => ({
      id: issue.id,
      test_run_id: issue.run_id,
      project_id: filters?.project_id || "",
      severity: issue.severity as "critical" | "high" | "medium" | "low",
      status: issue.status as "open" | "in_progress" | "resolved" | "wont_fix",
      title: issue.title,
      description: issue.description,
      state_name: issue.state_name || "",
      transition_from: null,
      transition_to: null,
      error_message: null,
      screenshot_url: null,
      reproduction_steps: issue.reproduction_steps || [],
      expected_behavior: "",
      actual_behavior: "",
      assigned_to: null,
      resolved_at: null,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
    }));

    return {
      items,
      total: response.pagination.total,
      page,
      page_size: limit,
      total_pages,
    };
  }

  /**
   * Update a deficiency
   * Now calls the unified execution issues API
   */
  async updateDeficiency(
    id: string,
    data: Partial<Deficiency>
  ): Promise<Deficiency> {
    // Map deficiency fields to execution issue update fields
    const updateData: Record<string, unknown> = {};
    if (data.status) updateData.status = data.status;
    if (data.severity) updateData.severity = data.severity;
    if (data.assigned_to) updateData.assigned_to_user_id = data.assigned_to;

    const issue = await this.httpClient.put<{
      id: string;
      run_id: string;
      issue_type: string;
      severity: string;
      status: string;
      source: string;
      title: string;
      description: string;
      state_name?: string;
      action_sequence_number?: number;
      reproduction_steps?: string[];
      created_at: string;
      updated_at: string;
    }>(`/api/v1/execution/issues/${id}`, updateData);

    return {
      id: issue.id,
      test_run_id: issue.run_id,
      project_id: data.project_id || "",
      severity: issue.severity as "critical" | "high" | "medium" | "low",
      status: issue.status as "open" | "in_progress" | "resolved" | "wont_fix",
      title: issue.title,
      description: issue.description,
      state_name: issue.state_name || "",
      transition_from: null,
      transition_to: null,
      error_message: null,
      screenshot_url: null,
      reproduction_steps: issue.reproduction_steps || [],
      expected_behavior: "",
      actual_behavior: "",
      assigned_to: null,
      resolved_at: null,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
    };
  }

  /**
   * Fetch coverage trends over time
   * Now calls the unified execution analytics API
   */
  async getCoverageTrends(
    projectId: string,
    startDate?: string,
    endDate?: string
  ): Promise<CoverageTrend[]> {
    const params = new URLSearchParams({ project_id: projectId });

    // Default to last 30 days if not specified
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const defaultStartDate =
      thirtyDaysAgo.toISOString().split("T")[0] ??
      thirtyDaysAgo.toISOString().slice(0, 10);
    const defaultEndDate =
      now.toISOString().split("T")[0] ?? now.toISOString().slice(0, 10);

    params.append("start_date", startDate || defaultStartDate);
    params.append("end_date", endDate || defaultEndDate);
    params.append("run_type", "qa_test");
    params.append("granularity", "daily");

    const queryString = params.toString();
    // Use the new unified execution analytics API
    const url = `/api/v1/execution/analytics/trends${queryString ? `?${queryString}` : ""}`;

    try {
      const response = await this.httpClient.get<{
        project_id: string;
        run_type?: string;
        start_date: string;
        end_date: string;
        granularity: string;
        data_points: Array<{
          date: string;
          runs_count: number;
          success_rate: number;
          avg_duration_seconds: number;
          total_actions: number;
          issues_count: number;
        }>;
        overall_stats: {
          total_runs: number;
          avg_success_rate: number;
          total_actions: number;
          total_issues: number;
        };
      }>(url);

      // Transform execution trends to coverage trends format for backward compatibility
      return response.data_points.map((dp) => ({
        date: dp.date,
        coverage_percentage: dp.success_rate * 100, // Convert success rate to percentage
        states_covered: dp.total_actions,
        total_states: dp.total_actions,
        test_run_count: dp.runs_count,
      }));
    } catch (error) {
      // Return empty array if endpoint not available yet
      console.warn("[getCoverageTrends] Failed to fetch trends:", error);
      return [];
    }
  }

  /**
   * Fetch reliability statistics
   * Now calls the unified execution analytics API
   */
  async getReliabilityStats(
    projectId: string,
    workflowId?: string
  ): Promise<ReliabilityStats> {
    const params = new URLSearchParams({ project_id: projectId });

    if (workflowId) params.append("workflow_id", workflowId);

    const queryString = params.toString();
    // Use the new unified execution analytics API
    const url = `/api/v1/execution/analytics/reliability${queryString ? `?${queryString}` : ""}`;

    try {
      const response = await this.httpClient.get<{
        stats: Array<{
          action_name: string;
          action_type: string;
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
        }>;
      }>(url);

      // Calculate aggregated stats
      const totalTransitions = response.stats.reduce(
        (sum, t) => sum + t.total_executions,
        0
      );
      const successfulTransitions = response.stats.reduce(
        (sum, t) => sum + t.successful_executions,
        0
      );
      const failedTransitions = response.stats.reduce(
        (sum, t) => sum + t.failed_executions,
        0
      );
      const avgDuration =
        response.stats.length > 0
          ? response.stats.reduce((sum, t) => sum + t.avg_duration_ms, 0) /
            response.stats.length
          : 0;

      // Sort by success rate
      const sortedBySuccess = [...response.stats].sort(
        (a, b) => b.success_rate - a.success_rate
      );

      // Transform to frontend format
      const transformAction = (
        t: (typeof response.stats)[0]
      ): TransitionReliability => ({
        from_state: "",
        to_state: "",
        action_type: t.action_name,
        success_rate: t.success_rate,
        total_attempts: t.total_executions,
        average_duration_ms: t.avg_duration_ms,
      });

      const overallSuccessRate =
        totalTransitions > 0 ? successfulTransitions / totalTransitions : 0;

      return {
        overall_success_rate: overallSuccessRate,
        total_transitions_tested: totalTransitions,
        successful_transitions: successfulTransitions,
        failed_transitions: failedTransitions,
        average_transition_time_ms: avgDuration,
        most_reliable_transitions: sortedBySuccess
          .slice(0, 5)
          .map(transformAction),
        least_reliable_transitions: sortedBySuccess
          .slice(-5)
          .reverse()
          .map(transformAction),
        state_reliability: [],
      };
    } catch (error) {
      // Return default stats if endpoint not available yet
      console.warn("[getReliabilityStats] Failed to fetch reliability:", error);
      return {
        overall_success_rate: 0,
        total_transitions_tested: 0,
        successful_transitions: 0,
        failed_transitions: 0,
        average_transition_time_ms: 0,
        most_reliable_transitions: [],
        least_reliable_transitions: [],
        state_reliability: [],
      };
    }
  }

  /**
   * Fetch state graph data for visualization
   * Note: This endpoint needs to be implemented in the execution API.
   * For now, builds a basic graph from execution run data.
   */
  async getStateGraph(
    projectId: string,
    _workflowId: string // Unused for now - will be used when API supports workflow filtering
  ): Promise<StateGraphData> {
    try {
      // Fetch recent runs to build graph data
      const runsResponse = await this.httpClient.get<{
        runs: ExecutionRunBackend[];
        pagination: Pagination;
      }>(
        `/api/v1/execution/runs?project_id=${projectId}&run_type=qa_test&limit=10`
      );

      // Build graph from run data
      const stateVisits: Map<string, { count: number; successCount: number }> =
        new Map();
      const transitionCounts: Map<
        string,
        { count: number; successCount: number }
      > = new Map();

      for (const run of runsResponse.runs) {
        // Fetch actions to build state graph
        const actionsResponse = await this.httpClient.get<{
          actions: Array<{
            from_state?: string;
            to_state?: string;
            status: string;
          }>;
          pagination: Pagination;
        }>(`/api/v1/execution/runs/${run.id}/actions?limit=500`);

        for (const action of actionsResponse.actions) {
          if (action.to_state) {
            const existing = stateVisits.get(action.to_state) || {
              count: 0,
              successCount: 0,
            };
            existing.count++;
            if (action.status === "success") existing.successCount++;
            stateVisits.set(action.to_state, existing);
          }

          if (action.from_state && action.to_state) {
            const key = `${action.from_state}->${action.to_state}`;
            const existing = transitionCounts.get(key) || {
              count: 0,
              successCount: 0,
            };
            existing.count++;
            if (action.status === "success") existing.successCount++;
            transitionCounts.set(key, existing);
          }
        }
      }

      // Convert to graph format
      const nodes: GraphNode[] = Array.from(stateVisits.entries()).map(
        ([id, stats]) => ({
          id,
          label: id,
          visit_count: stats.count,
          success_rate: stats.count > 0 ? stats.successCount / stats.count : 0,
          type: "normal" as const,
        })
      );

      const edges: GraphEdge[] = Array.from(transitionCounts.entries()).map(
        ([key, stats]) => {
          const parts = key.split("->");
          const source = parts[0] ?? "";
          const target = parts[1] ?? "";
          return {
            id: key,
            source,
            target,
            label: `${stats.count} runs`,
            success_rate:
              stats.count > 0 ? stats.successCount / stats.count : 0,
            attempt_count: stats.count,
          };
        }
      );

      return { nodes, edges };
    } catch (error) {
      console.warn("[getStateGraph] Failed to fetch state graph:", error);
      return { nodes: [], edges: [] };
    }
  }

  /**
   * Export test run data
   * Note: Export endpoint needs to be implemented in execution API.
   * For now, fetches the run data and converts to requested format client-side.
   */
  async exportTestRun(
    id: string,
    format: "json" | "csv" | "pdf"
  ): Promise<Blob> {
    // Fetch the run data
    const runData = await this.getTestRun(id);

    if (format === "json") {
      return new Blob([JSON.stringify(runData, null, 2)], {
        type: "application/json",
      });
    } else if (format === "csv") {
      // Convert to CSV format
      const headers = [
        "id",
        "project_id",
        "workflow_name",
        "status",
        "start_time",
        "end_time",
        "duration_seconds",
        "coverage_percentage",
      ];
      const values = [
        runData.id,
        runData.project_id,
        runData.workflow_name,
        runData.status,
        runData.start_time,
        runData.end_time || "",
        runData.duration_seconds?.toString() || "",
        runData.coverage_percentage.toString(),
      ];
      const csv =
        headers.join(",") + "\n" + values.map((v) => `"${v}"`).join(",");
      return new Blob([csv], { type: "text/csv" });
    } else {
      // PDF export not supported client-side
      throw new Error("PDF export requires server-side implementation");
    }
  }

  /**
   * Export deficiencies data
   * Note: Export endpoint needs to be implemented in execution API.
   * For now, fetches the issue data and converts to requested format client-side.
   */
  async exportDeficiencies(
    filters: DeficiencyFilters,
    format: "json" | "csv"
  ): Promise<Blob> {
    const data = await this.getDeficiencies(filters);

    if (format === "json") {
      return new Blob([JSON.stringify(data.items, null, 2)], {
        type: "application/json",
      });
    } else {
      // Convert to CSV format
      const headers = [
        "id",
        "title",
        "severity",
        "status",
        "state_name",
        "created_at",
      ];
      const rows = data.items.map((item) =>
        [
          item.id,
          item.title,
          item.severity,
          item.status,
          item.state_name,
          item.created_at,
        ]
          .map((v) => `"${v}"`)
          .join(",")
      );
      const csv = headers.join(",") + "\n" + rows.join("\n");
      return new Blob([csv], { type: "text/csv" });
    }
  }

  /**
   * Compare two test runs
   * Note: Comparison endpoint needs to be implemented in execution API.
   * For now, fetches both runs and computes comparison client-side.
   */
  async compareTestRuns(
    run1Id: string,
    run2Id: string
  ): Promise<TestRunComparisonData> {
    // Fetch both runs
    const [run1, run2] = await Promise.all([
      this.getTestRun(run1Id),
      this.getTestRun(run2Id),
    ]);

    // Build transition comparison
    const run1Transitions = new Map(
      run1.transitions.map((t) => [`${t.from_state}->${t.to_state}`, t])
    );
    const run2Transitions = new Map(
      run2.transitions.map((t) => [`${t.from_state}->${t.to_state}`, t])
    );

    const regressions: TransitionComparison[] = [];
    const fixed: TransitionComparison[] = [];
    const newFailures: TransitionComparison[] = [];

    for (const [key, t1] of run1Transitions) {
      const t2 = run2Transitions.get(key);
      if (t2) {
        if (t1.success && !t2.success) {
          regressions.push({
            from_state: t1.from_state,
            to_state: t1.to_state,
            status: "failed",
            run1_success: true,
            run2_success: false,
            run2_error: t2.error_message,
          });
        } else if (!t1.success && t2.success) {
          fixed.push({
            from_state: t1.from_state,
            to_state: t1.to_state,
            status: "fixed",
            run1_success: false,
            run2_success: true,
            run1_error: t1.error_message,
          });
        }
      } else if (!t1.success) {
        // Was in run1 but not run2, failed in run1
        newFailures.push({
          from_state: t1.from_state,
          to_state: t1.to_state,
          status: "new",
          run1_success: false,
          run2_success: false,
          run1_error: t1.error_message,
        });
      }
    }

    return {
      run1: {
        id: run1.id,
        project_id: run1.project_id,
        workflow_id: run1.workflow_id,
        workflow_name: run1.workflow_name,
        status: run1.status,
        start_time: run1.start_time,
        end_time: run1.end_time,
        duration_seconds: run1.duration_seconds,
        total_transitions: run1.total_transitions,
        successful_transitions: run1.successful_transitions,
        failed_transitions: run1.failed_transitions,
        coverage_percentage: run1.coverage_percentage,
        states_covered: run1.states_covered,
        total_states: run1.total_states,
        deficiencies_found: run1.deficiencies_found,
        runner_id: run1.runner_id,
        created_at: run1.created_at,
        updated_at: run1.updated_at,
      },
      run2: {
        id: run2.id,
        project_id: run2.project_id,
        workflow_id: run2.workflow_id,
        workflow_name: run2.workflow_name,
        status: run2.status,
        start_time: run2.start_time,
        end_time: run2.end_time,
        duration_seconds: run2.duration_seconds,
        total_transitions: run2.total_transitions,
        successful_transitions: run2.successful_transitions,
        failed_transitions: run2.failed_transitions,
        coverage_percentage: run2.coverage_percentage,
        states_covered: run2.states_covered,
        total_states: run2.total_states,
        deficiencies_found: run2.deficiencies_found,
        runner_id: run2.runner_id,
        created_at: run2.created_at,
        updated_at: run2.updated_at,
      },
      comparison: {
        coverage_diff: {
          percentage_change:
            run2.coverage_percentage - run1.coverage_percentage,
          states_gained: run2.states_covered - run1.states_covered,
          transitions_gained: run2.total_transitions - run1.total_transitions,
        },
        deficiencies_diff: {
          new_count: Math.max(
            0,
            run2.deficiencies_found - run1.deficiencies_found
          ),
          resolved_count: Math.max(
            0,
            run1.deficiencies_found - run2.deficiencies_found
          ),
        },
        execution_time_diff: {
          seconds_change:
            (run2.duration_seconds || 0) - (run1.duration_seconds || 0),
          percentage_change: run1.duration_seconds
            ? (((run2.duration_seconds || 0) - run1.duration_seconds) /
                run1.duration_seconds) *
              100
            : 0,
        },
        regressions,
        fixed,
        new_failures: newFailures,
        unchanged_count: run1.transitions.filter((t) => {
          const key = `${t.from_state}->${t.to_state}`;
          const t2 = run2Transitions.get(key);
          return t2 && t.success === t2.success;
        }).length,
      },
    };
  }
}
