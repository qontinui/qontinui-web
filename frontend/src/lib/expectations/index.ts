/**
 * Expectations module - Type-safe workflow expectations
 *
 * This module provides TypeScript types and utilities for working with
 * Qontinui workflow expectations, including checkpoints, assertions,
 * and success criteria.
 *
 * @module expectations
 */

// Export all types
export type {
  ScreenRegion,
  OcrAssertionType,
  TextPresentAssertion,
  TextAbsentAssertion,
  NoDuplicateMatchesAssertion,
  TextCountAssertion,
  TextInRegionAssertion,
  OcrAssertion,
  CheckpointDefinition,
  GlobalExpectations,
  SuccessCriteriaType,
  AllActionsPassCriteria,
  MinMatchesCriteria,
  MaxFailuresCriteria,
  CheckpointPassedCriteria,
  RequiredStatesCriteria,
  CustomCriteria,
  SuccessCriteria,
  ActionDefaults,
  ActionExpectations,
  WorkflowExpectations,
  CheckpointValidationResult,
  AssertionResult,
  ClaudeReviewResult,
  WorkflowExecutionResult,
} from "./types";

// Export type guards
export {
  isMinMatchesCriteria,
  isMaxFailuresCriteria,
  isCheckpointPassedCriteria,
  isRequiredStatesCriteria,
  isCustomCriteria,
  isTextCountAssertion,
  isTextInRegionAssertion,
  EXPECTATION_DEFAULTS,
} from "./types";
