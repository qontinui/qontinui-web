/**
 * Expectations components for workflow validation
 *
 * Provides UI components for configuring:
 * - Global expectations (workflow-level settings)
 * - Success criteria (validation rules)
 * - Checkpoints (named validation points)
 * - Action expectations (per-action settings)
 * - Execution results display (viewing expectations evaluation)
 */

export { GlobalExpectationsEditor } from "./GlobalExpectationsEditor";
export { SuccessCriteriaEditor } from "./SuccessCriteriaEditor";
export { CheckpointListEditor } from "./CheckpointListEditor";
export { ActionExpectationsEditor } from "./ActionExpectationsEditor";
export { ExpectationsPanel } from "./ExpectationsPanel";
export { ExecutionResultsDisplay } from "./ExecutionResultsDisplay";
export { ExecutionResultsBadge } from "./ExecutionResultsBadge";

// Re-export types for convenience
export type {
  WorkflowExpectations,
  GlobalExpectations,
  SuccessCriteria,
  SuccessCriteriaType,
  CheckpointDefinition,
  ActionExpectations,
  WorkflowExecutionResult,
  CheckpointValidationResult,
  AssertionResult,
  ClaudeReviewResult,
} from "@/lib/expectations/types";
