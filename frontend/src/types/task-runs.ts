/**
 * TypeScript types for Task Runs
 *
 * Re-exports canonical types from @qontinui/shared-types/task-run.
 * Web-specific extensions and types not in shared-types are defined locally.
 */

// =============================================================================
// Re-exports from @qontinui/shared-types/task-run
// =============================================================================

export type {
  TaskRunStatus,
  TaskRunFindingCategory,
  TaskRunFindingSeverity,
  TaskRunFindingStatus,
  TaskRunFindingActionType,
  TaskRunBackend,
  TaskRunSession,
  TaskRunFinding,
  TaskRunFindingResponse,
  TaskRunFindingSummary,
  TaskRunBackendDetail,
  TaskRunCreate,
  TaskRunUpdate,
  TaskRunFindingUpdate,
  TaskRunFindingCreate,
  TaskRunFilters,
  TaskRunFindingFilters,
  Pagination,
  TaskRunListResponse,
  TaskRunFindingsListResponse,
  FindingsSummary,
  CheckIssueDetail,
  IndividualCheckResult,
  VerificationStepDetails,
  StepExecutionConfig,
  GateEvaluationResult,
  VerificationPhaseResult,
  VerificationResultResponse,
  VerificationResultsListResponse,
} from "@qontinui/shared-types/task-run";

// =============================================================================
// Web-Specific: VerificationStepResult with comparison_result
// =============================================================================

// Import the base type and re-export an extended version with the web-specific field
import type { VerificationStepResult as _BaseVerificationStepResult } from "@qontinui/shared-types/task-run";

export interface VerificationStepResult extends _BaseVerificationStepResult {
  comparison_result?: import("@/lib/runner/types/exploration").ComparisonResult;
}
