/**
 * Testing to Execution API Adapters
 *
 * Maps legacy QA Testing API types to Unified Execution API types.
 * Use these adapters during migration to maintain backward compatibility
 * while transitioning to the unified execution API.
 */

import type {
  TestRunResponse,
  TestRunDetail,
  TransitionResponse,
  DeficiencyResponse,
  DeficiencyDetail,
  TestRunStatus,
  TransitionStatus,
  DeficiencySeverity,
  DeficiencyStatus,
  DeficiencyType,
  CoverageTrendDataPoint as TestingCoverageTrendDataPoint,
  TransitionReliabilityStats,
} from "@/types/generated/testing";

import type {
  ExecutionRunResponse,
  ExecutionRunDetail,
  ActionExecutionResponse,
  ExecutionIssueResponse,
  ExecutionIssueDetail,
  ExecutionStats,
  CoverageData,
  RunType,
  RunStatus,
  ActionStatus,
  ActionType,
  IssueSeverity,
  IssueStatus,
  IssueType,
  IssueSource,
  ExecutionTrendDataPoint,
  ActionReliabilityStats,
} from "@/types/generated/execution";

// =============================================================================
// Status Mapping Functions
// =============================================================================

/**
 * Map TestRunStatus to RunStatus
 */
export function mapTestStatusToRunStatus(status: TestRunStatus): RunStatus {
  const statusMap: Record<TestRunStatus, RunStatus> = {
    running: "running" as RunStatus,
    completed: "completed" as RunStatus,
    failed: "failed" as RunStatus,
    timeout: "timeout" as RunStatus,
    cancelled: "cancelled" as RunStatus,
  };
  return statusMap[status] || ("completed" as RunStatus);
}

/**
 * Map RunStatus to TestRunStatus
 */
export function mapRunStatusToTestStatus(status: RunStatus): TestRunStatus {
  const statusMap: Record<string, TestRunStatus> = {
    pending: "running" as TestRunStatus,
    running: "running" as TestRunStatus,
    completed: "completed" as TestRunStatus,
    failed: "failed" as TestRunStatus,
    timeout: "timeout" as TestRunStatus,
    cancelled: "cancelled" as TestRunStatus,
    paused: "running" as TestRunStatus,
  };
  return statusMap[status] || ("completed" as TestRunStatus);
}

/**
 * Map TransitionStatus to ActionStatus
 */
export function mapTransitionStatusToActionStatus(
  status: TransitionStatus
): ActionStatus {
  const statusMap: Record<TransitionStatus, ActionStatus> = {
    success: "success" as ActionStatus,
    failed: "failed" as ActionStatus,
    timeout: "timeout" as ActionStatus,
    skipped: "skipped" as ActionStatus,
    error: "error" as ActionStatus,
  };
  return statusMap[status] || ("success" as ActionStatus);
}

/**
 * Map DeficiencySeverity to IssueSeverity
 */
export function mapDeficiencySeverityToIssueSeverity(
  severity: DeficiencySeverity
): IssueSeverity {
  const severityMap: Record<string, IssueSeverity> = {
    critical: "critical" as IssueSeverity,
    high: "high" as IssueSeverity,
    medium: "medium" as IssueSeverity,
    low: "low" as IssueSeverity,
    informational: "info" as IssueSeverity,
  };
  return severityMap[severity] || ("medium" as IssueSeverity);
}

/**
 * Map IssueSeverity to DeficiencySeverity
 */
export function mapIssueSeverityToDeficiencySeverity(
  severity: IssueSeverity
): DeficiencySeverity {
  const severityMap: Record<string, DeficiencySeverity> = {
    critical: "critical" as DeficiencySeverity,
    high: "high" as DeficiencySeverity,
    medium: "medium" as DeficiencySeverity,
    low: "low" as DeficiencySeverity,
    info: "informational" as DeficiencySeverity,
  };
  return severityMap[severity] || ("medium" as DeficiencySeverity);
}

/**
 * Map DeficiencyStatus to IssueStatus
 */
export function mapDeficiencyStatusToIssueStatus(
  status: DeficiencyStatus
): IssueStatus {
  const statusMap: Record<DeficiencyStatus, IssueStatus> = {
    new: "new" as IssueStatus,
    open: "open" as IssueStatus,
    in_progress: "in_progress" as IssueStatus,
    resolved: "resolved" as IssueStatus,
    closed: "closed" as IssueStatus,
    wont_fix: "wont_fix" as IssueStatus,
  };
  return statusMap[status] || ("open" as IssueStatus);
}

/**
 * Map DeficiencyType to IssueType
 */
export function mapDeficiencyTypeToIssueType(
  defType: DeficiencyType
): IssueType {
  const typeMap: Record<string, IssueType> = {
    functional_bug: "functional" as IssueType,
    ui_issue: "visual" as IssueType,
    performance: "performance" as IssueType,
    crash: "crash" as IssueType,
    security: "other" as IssueType,
    accessibility: "other" as IssueType,
    data: "other" as IssueType,
    other: "other" as IssueType,
  };
  return typeMap[defType] || ("other" as IssueType);
}

// =============================================================================
// Test Run -> Execution Run Adapters
// =============================================================================

/**
 * Map TestRunResponse to ExecutionRunResponse
 */
export function mapTestRunToExecutionRun(
  testRun: TestRunResponse
): ExecutionRunResponse {
  return {
    id: testRun.run_id,
    project_id: testRun.project_id,
    run_type: "qa_test" as RunType,
    run_name: testRun.run_name,
    status: mapTestStatusToRunStatus(testRun.status),
    started_at: testRun.started_at,
    ended_at: testRun.ended_at ?? undefined,
    duration_seconds: testRun.duration_seconds ?? undefined,
    runner_metadata:
      testRun.runner_metadata as ExecutionRunResponse["runner_metadata"],
    workflow_metadata: undefined,
    created_at: testRun.created_at,
  };
}

/**
 * Map TestRunDetail to ExecutionRunDetail
 */
export function mapTestRunDetailToExecutionRunDetail(
  testRun: TestRunDetail
): ExecutionRunDetail {
  // Extract stats from final_metrics
  const finalMetrics = (testRun.final_metrics || {}) as Record<string, unknown>;
  const coverageData = (testRun.coverage_data || {}) as Record<string, unknown>;

  const stats: ExecutionStats = {
    total_actions: (finalMetrics.total_transitions_executed as number) || 0,
    successful_actions: (finalMetrics.successful_transitions as number) || 0,
    failed_actions: (finalMetrics.failed_transitions as number) || 0,
    skipped_actions: 0,
    timeout_actions: 0,
    total_screenshots: testRun.screenshots?.length || 0,
    total_issues: testRun.deficiencies?.length || 0,
    unique_states_visited: (coverageData.unique_states_visited as number) || 0,
    unique_actions_executed:
      (coverageData.unique_transitions_covered as number) || 0,
  };

  const coverage: CoverageData | undefined = coverageData.coverage_percentage
    ? {
        coverage_percentage: coverageData.coverage_percentage as number,
        states_covered: (coverageData.states_covered as number) || 0,
        states_total: (coverageData.states_total as number) || 0,
        transitions_covered:
          (coverageData.unique_transitions_covered as number) || 0,
        transitions_total: (coverageData.total_transitions as number) || 0,
        state_coverage_map:
          (coverageData.state_coverage_map as Record<string, number>) || {},
        transition_coverage_map:
          (coverageData.transition_coverage_map as Record<string, number>) ||
          {},
        uncovered_transitions:
          (coverageData.uncovered_transitions as string[]) || [],
      }
    : undefined;

  return {
    id: testRun.run_id,
    project_id: testRun.project_id,
    run_type: "qa_test" as RunType,
    run_name: testRun.run_name,
    status: mapTestStatusToRunStatus(testRun.status),
    started_at: testRun.started_at,
    ended_at: testRun.ended_at ?? undefined,
    duration_seconds: testRun.duration_seconds ?? undefined,
    runner_metadata:
      testRun.runner_metadata as ExecutionRunDetail["runner_metadata"],
    workflow_metadata: testRun.workflow_metadata
      ? {
          workflow_id: (testRun.workflow_metadata as Record<string, unknown>)
            .workflow_id as string,
          workflow_name: (testRun.workflow_metadata as Record<string, unknown>)
            .workflow_name as string,
          workflow_version:
            ((testRun.workflow_metadata as Record<string, unknown>)
              .workflow_version as string) || undefined,
          total_states:
            ((testRun.workflow_metadata as Record<string, unknown>)
              .total_states as number) || undefined,
          total_transitions:
            ((testRun.workflow_metadata as Record<string, unknown>)
              .total_transitions as number) || undefined,
          tags: undefined,
        }
      : undefined,
    created_at: testRun.created_at,
    description: testRun.description ?? undefined,
    configuration: testRun.configuration_snapshot || {},
    stats,
    coverage,
    updated_at: testRun.updated_at ?? undefined,
  };
}

// =============================================================================
// Transition -> Action Adapters
// =============================================================================

/**
 * Map TransitionResponse to ActionExecutionResponse
 */
export function mapTransitionToAction(
  transition: TransitionResponse,
  runId: string
): ActionExecutionResponse {
  return {
    id: transition.transition_id,
    run_id: runId,
    sequence_number: transition.sequence_number,
    action_type: "transition" as ActionType,
    action_name: transition.transition_name,
    status: mapTransitionStatusToActionStatus(transition.status),
    started_at: transition.started_at,
    completed_at: transition.completed_at,
    duration_ms: transition.duration_ms,
    from_state: transition.from_state,
    to_state: transition.to_state,
    error_message: transition.error_message ?? undefined,
  };
}

// =============================================================================
// Deficiency -> Issue Adapters
// =============================================================================

/**
 * Map DeficiencyResponse to ExecutionIssueResponse
 */
export function mapDeficiencyToIssue(
  deficiency: DeficiencyResponse
): ExecutionIssueResponse {
  return {
    id: deficiency.deficiency_id,
    run_id: deficiency.run_id,
    issue_type: mapDeficiencyTypeToIssueType(deficiency.deficiency_type),
    severity: mapDeficiencySeverityToIssueSeverity(deficiency.severity),
    status: mapDeficiencyStatusToIssueStatus(deficiency.status),
    source: "automation" as IssueSource,
    title: deficiency.title,
    description: deficiency.description,
    state_name: deficiency.state ?? undefined,
    screenshot_count: deficiency.screenshot_count || 0,
    created_at: deficiency.created_at,
    updated_at: deficiency.updated_at,
  };
}

/**
 * Map DeficiencyDetail to ExecutionIssueDetail
 */
export function mapDeficiencyDetailToIssueDetail(
  deficiency: DeficiencyDetail
): ExecutionIssueDetail {
  return {
    id: deficiency.deficiency_id,
    run_id: deficiency.run_id,
    issue_type: mapDeficiencyTypeToIssueType(deficiency.deficiency_type),
    severity: mapDeficiencySeverityToIssueSeverity(deficiency.severity),
    status: mapDeficiencyStatusToIssueStatus(deficiency.status),
    source: "automation" as IssueSource,
    title: deficiency.title,
    description: deficiency.description,
    state_name: deficiency.state ?? undefined,
    screenshot_count: deficiency.screenshots?.length || 0,
    created_at: deficiency.created_at,
    updated_at: deficiency.updated_at,
    action_sequence_number: deficiency.transition_sequence_number ?? undefined,
    reproduction_steps: deficiency.reproduction_steps || [],
    screenshots: [], // Would need to map screenshots separately
    error_details: deficiency.metadata || {},
    metadata: deficiency.metadata || {},
    assigned_to: deficiency.assigned_to
      ? {
          user_id:
            (deficiency.assigned_to as Record<string, string>).user_id || "",
          email: (deficiency.assigned_to as Record<string, string>).email || "",
          full_name: (deficiency.assigned_to as Record<string, string>)
            .full_name,
        }
      : undefined,
    resolution_notes: deficiency.resolution_notes ?? undefined,
  };
}

// =============================================================================
// Analytics Adapters
// =============================================================================

/**
 * Map Coverage trend data point from testing to execution format
 */
export function mapCoverageTrendDataPoint(
  point: TestingCoverageTrendDataPoint
): ExecutionTrendDataPoint {
  return {
    date: point.date,
    runs_count: point.runs_count,
    success_rate: point.avg_coverage_percentage, // Approximate mapping
    avg_duration_seconds: 0, // Not available in testing format
    total_actions: point.total_transitions_executed,
    issues_count: 0, // Not available in testing format
  };
}

/**
 * Map TransitionReliabilityStats to ActionReliabilityStats
 */
export function mapTransitionReliabilityToActionReliability(
  stats: TransitionReliabilityStats
): ActionReliabilityStats {
  return {
    action_name: stats.transition_name,
    action_type: "transition" as ActionType,
    total_executions: stats.total_executions,
    successful_executions: stats.successful_executions,
    failed_executions: stats.failed_executions,
    success_rate: stats.success_rate,
    avg_duration_ms: stats.avg_duration_ms,
    p50_duration_ms: stats.median_duration_ms,
    p95_duration_ms: stats.p95_duration_ms,
    common_errors: (stats.failure_modes || []).map((mode) => ({
      error_type:
        ((mode as Record<string, unknown>).error_type as string) || "unknown",
      count: ((mode as Record<string, unknown>).count as number) || 0,
      percentage: ((mode as Record<string, unknown>).percentage as number) || 0,
    })),
  };
}

// =============================================================================
// Reverse Adapters (Execution -> Testing format for backward compatibility)
// =============================================================================

/**
 * Map ExecutionRunResponse to TestRunResponse
 * Use this when components still expect the legacy testing format
 */
export function mapExecutionRunToTestRun(
  run: ExecutionRunResponse
): TestRunResponse {
  return {
    run_id: run.id,
    project_id: run.project_id,
    run_name: run.run_name,
    status: mapRunStatusToTestStatus(run.status),
    started_at: run.started_at,
    ended_at: run.ended_at || null,
    duration_seconds: run.duration_seconds || null,
    runner_metadata: run.runner_metadata || {},
    created_at: run.created_at,
  };
}

/**
 * Map ExecutionIssueResponse to DeficiencyResponse
 * Use this when components still expect the legacy deficiency format
 */
/**
 * Map IssueStatus to DeficiencyStatus
 */
export function mapIssueStatusToDeficiencyStatus(
  status: IssueStatus
): DeficiencyStatus {
  const statusMap: Record<string, DeficiencyStatus> = {
    new: "new" as DeficiencyStatus,
    open: "open" as DeficiencyStatus,
    in_progress: "in_progress" as DeficiencyStatus,
    resolved: "resolved" as DeficiencyStatus,
    closed: "closed" as DeficiencyStatus,
    wont_fix: "wont_fix" as DeficiencyStatus,
  };
  return statusMap[status] || ("open" as DeficiencyStatus);
}

export function mapIssueToDeficiency(
  issue: ExecutionIssueResponse
): DeficiencyResponse {
  return {
    deficiency_id: issue.id,
    run_id: issue.run_id,
    title: issue.title,
    description: issue.description,
    severity: mapIssueSeverityToDeficiencySeverity(issue.severity),
    status: mapIssueStatusToDeficiencyStatus(issue.status),
    deficiency_type: "other" as DeficiencyType, // Simplified mapping
    state: issue.state_name || null,
    transition_sequence_number: null,
    screenshot_count: issue.screenshot_count,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    run_info: {},
  };
}

// =============================================================================
// Batch Conversion Helpers
// =============================================================================

/**
 * Map array of test runs to execution runs
 */
export function mapTestRunsToExecutionRuns(
  testRuns: TestRunResponse[]
): ExecutionRunResponse[] {
  return testRuns.map(mapTestRunToExecutionRun);
}

/**
 * Map array of deficiencies to issues
 */
export function mapDeficienciesToIssues(
  deficiencies: DeficiencyResponse[]
): ExecutionIssueResponse[] {
  return deficiencies.map(mapDeficiencyToIssue);
}

/**
 * Map array of transitions to actions
 */
export function mapTransitionsToActions(
  transitions: TransitionResponse[],
  runId: string
): ActionExecutionResponse[] {
  return transitions.map((t) => mapTransitionToAction(t, runId));
}
