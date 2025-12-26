// services/integration-testing.ts
// Service for Integration Testing API calls to qontinui-api

import { ApiConfig } from "./api-config";
import type {
  IntegrationTestRequest,
  IntegrationTestResponse,
  IntegrationTestRunListResponse,
  IntegrationTestRunSummary,
  WorkflowConfig,
  IntegrationTestOptions,
} from "@/types/integration-testing";

/**
 * Integration Testing Service
 *
 * Communicates with qontinui-api to run integration tests in MOCK mode.
 * Integration tests execute workflows using historical data instead of live GUI.
 */
class IntegrationTestingService {
  private apiUrl: string;

  constructor() {
    this.apiUrl = ApiConfig.getApiUrl();
  }

  /**
   * Run an integration test for a workflow
   *
   * @param projectId - The project ID
   * @param workflowConfig - The workflow configuration to test
   * @param options - Optional test execution options
   * @returns The integration test result with step-by-step execution details
   */
  async runIntegrationTest(
    projectId: string,
    workflowConfig: WorkflowConfig,
    options?: IntegrationTestOptions
  ): Promise<IntegrationTestResponse> {
    const request: IntegrationTestRequest = {
      project_id: projectId,
      workflow_config: workflowConfig,
      initial_states: workflowConfig.initial_state_ids,
      options,
    };

    const response = await fetch(
      `${this.apiUrl}/api/v1/integration-test/run/${projectId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail || `Integration test failed: ${response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Get a list of integration test runs for a project
   *
   * @param projectId - The project ID
   * @param limit - Maximum number of runs to return
   * @param offset - Offset for pagination
   * @returns List of integration test run summaries
   */
  async getIntegrationTestRuns(
    projectId: string,
    limit = 20,
    offset = 0
  ): Promise<IntegrationTestRunListResponse> {
    // Query the main backend for execution runs with run_type=integration_test
    const params = new URLSearchParams({
      run_type: "integration_test",
      limit: limit.toString(),
      offset: offset.toString(),
    });

    const response = await fetch(
      `/api/v1/execution/runs?project_id=${projectId}&${params.toString()}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail ||
          `Failed to fetch integration test runs: ${response.statusText}`
      );
    }

    // Transform the generic execution run response to IntegrationTestRunListResponse
    const data = await response.json();
    return {
      runs: data.runs.map((run: Record<string, unknown>) => ({
        id: run.id,
        workflow_id:
          (run.workflow_metadata as Record<string, unknown>)?.workflow_id ?? "",
        workflow_name:
          (run.workflow_metadata as Record<string, unknown>)?.workflow_name ??
          run.run_name,
        status: run.status,
        started_at: run.started_at,
        ended_at: run.ended_at,
        duration_ms: run.duration_seconds
          ? (run.duration_seconds as number) * 1000
          : 0,
        coverage_percentage:
          (run.coverage as Record<string, unknown>)?.coverage_percentage ?? 0,
        success_rate: calculateSuccessRate(
          run.stats as Record<string, unknown>
        ),
        total_actions:
          (run.stats as Record<string, unknown>)?.total_actions ?? 0,
        issues_count: (run.stats as Record<string, unknown>)?.total_issues ?? 0,
      })) as IntegrationTestRunSummary[],
      pagination: data.pagination,
    };
  }

  /**
   * Get detailed results for a specific integration test run
   *
   * @param runId - The run ID
   * @returns Full integration test result with all steps and insights
   */
  async getIntegrationTestResult(
    runId: string
  ): Promise<IntegrationTestResponse> {
    const response = await fetch(`/api/v1/execution/runs/${runId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail ||
          `Failed to fetch integration test result: ${response.statusText}`
      );
    }

    const data = await response.json();
    return transformExecutionRunToIntegrationTest(data);
  }

  /**
   * Check if the qontinui-api is available
   *
   * @returns True if the API is reachable
   */
  async checkApiHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Calculate success rate from execution stats
 */
function calculateSuccessRate(
  stats: Record<string, unknown> | undefined
): number {
  if (!stats) return 0;
  const total = (stats.total_actions as number) ?? 0;
  const successful = (stats.successful_actions as number) ?? 0;
  if (total === 0) return 100;
  return Math.round((successful / total) * 100);
}

/**
 * Transform a generic execution run detail to IntegrationTestResponse
 */
function transformExecutionRunToIntegrationTest(
  data: Record<string, unknown>
): IntegrationTestResponse {
  const workflowMetadata =
    (data.workflow_metadata as Record<string, unknown>) ?? {};
  const stats = (data.stats as Record<string, unknown>) ?? {};
  const coverage = (data.coverage as Record<string, unknown>) ?? {};

  return {
    run_id: data.id as string,
    project_id: data.project_id as string,
    workflow_id: (workflowMetadata.workflow_id as string) ?? "",
    workflow_name:
      (workflowMetadata.workflow_name as string) ?? (data.run_name as string),
    status: data.status as "completed" | "failed" | "timeout",
    started_at: data.started_at as string,
    ended_at: data.ended_at as string,
    duration_ms: data.duration_seconds
      ? (data.duration_seconds as number) * 1000
      : 0,
    initial_states: (data.initial_states as string[]) ?? [],
    final_states: (data.final_states as string[]) ?? [],
    steps: (data.steps as IntegrationTestResponse["steps"]) ?? [],
    coverage_data: {
      states_covered: (coverage.states_covered as number) ?? 0,
      total_states: (coverage.states_total as number) ?? 0,
      transitions_covered: (coverage.transitions_covered as number) ?? 0,
      total_transitions: (coverage.transitions_total as number) ?? 0,
      coverage_percentage: (coverage.coverage_percentage as number) ?? 0,
    },
    stochasticity_warnings:
      (data.stochasticity_warnings as IntegrationTestResponse["stochasticity_warnings"]) ??
      [],
    coverage_gaps:
      (data.coverage_gaps as IntegrationTestResponse["coverage_gaps"]) ?? [],
    reliability_insights:
      (data.reliability_insights as IntegrationTestResponse["reliability_insights"]) ??
      [],
    summary: {
      total_steps: (data.steps as unknown[])?.length ?? 0,
      total_actions: (stats.total_actions as number) ?? 0,
      successful_actions: (stats.successful_actions as number) ?? 0,
      failed_actions: (stats.failed_actions as number) ?? 0,
      states_visited: (stats.unique_states_visited as number) ?? 0,
      transitions_executed: (coverage.transitions_covered as number) ?? 0,
      avg_action_duration_ms: 0,
      low_confidence_actions: 0,
    },
  };
}

// Export singleton instance
export const integrationTestingService = new IntegrationTestingService();

// Export class for testing
export { IntegrationTestingService };
