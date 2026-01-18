// services/integration-testing.ts
// Service for Integration Testing API calls to runner

import { ApiConfig } from "./api-config";
import type {
  IntegrationTestResponse,
  IntegrationTestRunListResponse,
  IntegrationTestRunSummary,
  WorkflowConfig,
  IntegrationTestOptions,
} from "@/types/integration-testing";

/**
 * Integration Testing Service
 *
 * Communicates with runner to run integration tests in MOCK mode.
 * Integration tests execute workflows using historical data instead of live GUI.
 */
class IntegrationTestingService {
  private apiUrl: string;

  constructor() {
    this.apiUrl = ApiConfig.getRunnerUrl();
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
    // Transform frontend schema to match backend expectations
    // Backend uses: workflow.id, workflow.name, fromState, activateStates, deactivateStates
    // Frontend uses: workflow_id, workflow_name, from_state_id, to_state_id
    const backendRequest = {
      workflow: {
        id: workflowConfig.workflow_id,
        name: workflowConfig.workflow_name,
        states: workflowConfig.states.map((s) => ({
          id: s.id,
          name: s.name,
          isInitial: s.is_initial ?? false,
          isBlocking: false,
          stateImages: s.patterns?.map((p) => ({ id: p, name: p })) ?? [],
        })),
        transitions: workflowConfig.transitions.map((t) => ({
          id: t.id,
          name: t.name,
          fromState: t.from_state_id,
          // to_state_id maps to activateStates, from_state_id maps to deactivateStates
          activateStates: [t.to_state_id],
          deactivateStates: [t.from_state_id],
          actionIds: t.actions?.map((a) => a.id) ?? [],
        })),
        actions: workflowConfig.transitions.flatMap((t) =>
          (t.actions ?? []).map((a) => ({
            id: a.id,
            type: a.type,
            name: a.id,
            config: a.config ?? {},
            patternId: a.pattern_id,
          }))
        ),
        initialStateIds: workflowConfig.initial_state_ids ?? [],
      },
      initialStates: workflowConfig.initial_state_ids,
      maxSteps: options?.max_steps ?? 100,
      includeVisualData: options?.record_screenshots ?? false,
    };

    const response = await fetch(
      `${this.apiUrl}/api/v1/integration-test/run/${projectId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(backendRequest),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      // Handle complex error structures (FastAPI returns detail as string or array)
      let errorMessage = `Integration test failed: ${response.statusText}`;
      if (errorData.detail) {
        if (typeof errorData.detail === "string") {
          errorMessage = errorData.detail;
        } else if (Array.isArray(errorData.detail)) {
          // Pydantic validation errors
          errorMessage = errorData.detail
            .map(
              (e: { msg?: string; loc?: string[] }) =>
                e.msg || JSON.stringify(e)
            )
            .join("; ");
        } else {
          errorMessage = JSON.stringify(errorData.detail);
        }
      }
      throw new Error(errorMessage);
    }

    // Transform backend response (camelCase) to frontend format (snake_case)
    const data = await response.json();
    return this.transformBackendResponse(data);
  }

  /**
   * Transform backend response to frontend IntegrationTestResponse format
   */
  private transformBackendResponse(
    data: Record<string, unknown>
  ): IntegrationTestResponse {
    return {
      run_id: (data.testId as string) ?? (data.test_id as string) ?? "",
      project_id:
        (data.projectId as string) ?? (data.project_id as string) ?? "",
      workflow_id:
        (data.workflowId as string) ?? (data.workflow_id as string) ?? "",
      workflow_name:
        (data.workflowName as string) ?? (data.workflow_name as string) ?? "",
      status: ((data.status as string) ?? "completed") as
        | "completed"
        | "failed"
        | "timeout",
      started_at:
        (data.startedAt as string) ??
        (data.started_at as string) ??
        new Date().toISOString(),
      ended_at:
        (data.completedAt as string) ??
        (data.ended_at as string) ??
        new Date().toISOString(),
      duration_ms:
        (data.totalDurationMs as number) ??
        (data.total_duration_ms as number) ??
        (data.duration_ms as number) ??
        0,
      initial_states:
        (data.initialStates as string[]) ??
        (data.initial_states as string[]) ??
        [],
      final_states:
        (data.finalActiveStates as string[]) ??
        (data.final_states as string[]) ??
        [],
      steps: this.transformSteps(
        (data.steps as Record<string, unknown>[]) ?? []
      ),
      coverage_data: this.transformCoverageData(
        data.coverageData ?? data.coverage_data
      ),
      stochasticity_warnings:
        (data.stochasticityWarnings as IntegrationTestResponse["stochasticity_warnings"]) ??
        (data.stochasticity_warnings as IntegrationTestResponse["stochasticity_warnings"]) ??
        [],
      coverage_gaps:
        (data.coverageGaps as IntegrationTestResponse["coverage_gaps"]) ??
        (data.coverage_gaps as IntegrationTestResponse["coverage_gaps"]) ??
        [],
      reliability_insights: this.transformReliabilityInsights(
        data.reliabilityInsights ?? data.reliability_insights
      ),
      summary: {
        total_steps: (data.steps as unknown[])?.length ?? 0,
        total_actions:
          ((data.successCount as number) ?? 0) +
          ((data.failureCount as number) ?? 0),
        successful_actions: (data.successCount as number) ?? 0,
        failed_actions: (data.failureCount as number) ?? 0,
        states_visited: 0,
        transitions_executed: 0,
        avg_action_duration_ms: 0,
        low_confidence_actions: 0,
      },
    };
  }

  private transformSteps(
    steps: Record<string, unknown>[]
  ): IntegrationTestResponse["steps"] {
    return steps.map((step) => {
      const stepType =
        (step.stepType as string) ??
        (step.step_type as string) ??
        (step.type as string) ??
        "action";
      const baseStep = {
        step_number:
          (step.stepNumber as number) ?? (step.step_number as number) ?? 0,
        timestamp: (step.timestamp as string) ?? new Date().toISOString(),
        duration_ms:
          (step.durationMs as number) ?? (step.duration_ms as number) ?? 0,
      };

      if (stepType === "state_discovery" || stepType === "STATE_DISCOVERY") {
        const discovery = (step.stateDiscovery ??
          step.state_discovery ??
          {}) as Record<string, unknown>;
        return {
          ...baseStep,
          type: "state_discovery" as const,
          active_states:
            (discovery.activeStates as string[]) ??
            (discovery.active_states as string[]) ??
            [],
          initial_states_match:
            (discovery.initialStatesMatch as boolean) ??
            (discovery.initial_states_match as boolean) ??
            true,
          expected_initial_states: [],
          detection_method: "mock" as const,
        };
      }

      // Default to a generic step structure
      return {
        ...baseStep,
        type: "state_discovery" as const,
        active_states: [],
        initial_states_match: true,
        expected_initial_states: [],
        detection_method: "mock" as const,
      };
    });
  }

  private transformCoverageData(
    data: unknown
  ): IntegrationTestResponse["coverage_data"] {
    if (!data || typeof data !== "object") {
      return {
        states_covered: 0,
        total_states: 0,
        transitions_covered: 0,
        total_transitions: 0,
        coverage_percentage: 0,
      };
    }
    const coverageData = data as Record<string, unknown>;
    return {
      states_covered:
        (coverageData.statesCovered as number) ??
        (coverageData.states_covered as number) ??
        0,
      total_states:
        (coverageData.totalStates as number) ??
        (coverageData.total_states as number) ??
        0,
      transitions_covered:
        (coverageData.transitionsCovered as number) ??
        (coverageData.transitions_covered as number) ??
        0,
      total_transitions:
        (coverageData.totalTransitions as number) ??
        (coverageData.total_transitions as number) ??
        0,
      coverage_percentage:
        (coverageData.coveragePercentage as number) ??
        (coverageData.coverage_percentage as number) ??
        0,
    };
  }

  private transformReliabilityInsights(
    data: unknown
  ): IntegrationTestResponse["reliability_insights"] {
    if (!data || typeof data !== "object") return [];
    const insights = data as Record<string, unknown>;
    // Backend returns ReliabilityInsights object with arrays inside
    const result: IntegrationTestResponse["reliability_insights"] = [];

    const lowSuccessRate = (insights.lowSuccessRatePatterns ??
      insights.low_success_rate_patterns) as unknown[];
    if (Array.isArray(lowSuccessRate)) {
      result.push(
        ...lowSuccessRate.map((p) => ({
          id: String((p as Record<string, unknown>).patternId ?? ""),
          insight_type: "low_success_rate" as const,
          severity: "high" as const,
          title: `Low success rate: ${(p as Record<string, unknown>).patternName ?? "Unknown"}`,
          description: `Success rate: ${(p as Record<string, unknown>).successRate ?? 0}%`,
          affected_patterns: [
            ((p as Record<string, unknown>).patternId as string) ?? "",
          ],
          affected_states: [],
          recommendation: "Review pattern reliability",
        }))
      );
    }

    return result;
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
    // Query the main backend for all execution runs (no run_type filter)
    // This includes integration_test, live_automation, and other run types
    const params = new URLSearchParams({
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
   * Check if the runner is available
   *
   * @returns True if the runner is reachable
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
    initial_states: (workflowMetadata.initial_state_ids as string[]) ?? [],
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
