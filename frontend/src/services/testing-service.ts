import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";

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

    return this.httpClient.get<PaginatedResponse<TestRun>>(url);
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

    return this.httpClient.get<CoverageTrend[]>(url);
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

    return this.httpClient.get<ReliabilityStats>(url);
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
}
