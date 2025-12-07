/**
 * Validation schemas for Qontinui Workflow Expectations using Zod.
 *
 * These schemas provide runtime validation for expectations data.
 * Use with react-hook-form's zodResolver for form validation.
 *
 * Example usage:
 *
 *   import { useForm } from 'react-hook-form'
 *   import { zodResolver } from '@hookform/resolvers/zod'
 *   import { workflowExpectationsSchema, type WorkflowExpectations } from '@/lib/validations/expectations'
 *
 *   function ExpectationsForm() {
 *     const form = useForm<WorkflowExpectations>({
 *       resolver: zodResolver(workflowExpectationsSchema),
 *       defaultValues: {
 *         global: {},
 *         checkpoints: {},
 *       }
 *     })
 *
 *     const onSubmit = (data: WorkflowExpectations) => {
 *       // data is fully typed and validated
 *     }
 *
 *     return <form onSubmit={form.handleSubmit(onSubmit)}>...</form>
 *   }
 */

import { z } from "zod";

/**
 * Screen region for OCR operations
 */
export const screenRegionSchema = z.object({
  x: z.number().int().min(0, "X coordinate must be non-negative"),
  y: z.number().int().min(0, "Y coordinate must be non-negative"),
  width: z.number().int().min(1, "Width must be at least 1 pixel"),
  height: z.number().int().min(1, "Height must be at least 1 pixel"),
});

/**
 * Base OCR assertion with common fields
 */
const baseOcrAssertionSchema = z.object({
  pattern: z.string().min(1, "Pattern is required"),
  regex: z.boolean().optional(),
  case_sensitive: z.boolean().optional(),
  description: z.string().optional(),
  is_critical: z.boolean().optional(),
});

/**
 * Assertion that text must be present
 */
export const textPresentAssertionSchema = baseOcrAssertionSchema.extend({
  type: z.literal("text_present"),
});

/**
 * Assertion that text must be absent
 */
export const textAbsentAssertionSchema = baseOcrAssertionSchema.extend({
  type: z.literal("text_absent"),
});

/**
 * Assertion that pattern should not match more than once
 */
export const noDuplicateMatchesAssertionSchema = baseOcrAssertionSchema.extend({
  type: z.literal("no_duplicate_matches"),
});

/**
 * Assertion that checks exact or bounded count of matches
 */
export const textCountAssertionSchema = baseOcrAssertionSchema.extend({
  type: z.literal("text_count"),
  count: z.number().int().min(0).optional(),
  min_count: z.number().int().min(0).optional(),
  max_count: z.number().int().min(0).optional(),
});

/**
 * Assertion that text must appear in a specific screen region
 */
export const textInRegionAssertionSchema = baseOcrAssertionSchema.extend({
  type: z.literal("text_in_region"),
  region: screenRegionSchema,
});

/**
 * Union of all OCR assertion types
 */
export const ocrAssertionSchema = z.discriminatedUnion("type", [
  textPresentAssertionSchema,
  textAbsentAssertionSchema,
  noDuplicateMatchesAssertionSchema,
  textCountAssertionSchema,
  textInRegionAssertionSchema,
]);

/**
 * Named checkpoint with assertions and validation rules
 */
export const checkpointDefinitionSchema = z.object({
  ocr_assertions: z.array(ocrAssertionSchema).optional(),
  claude_review: z
    .array(z.string().min(1, "Claude review instruction cannot be empty"))
    .optional(),
  screenshot_required: z.boolean().optional(),
  max_wait_ms: z.number().int().min(0).optional(),
  retry_interval_ms: z.number().int().min(0).optional(),
  description: z.string().optional(),
});

/**
 * Global expectations that apply to entire workflow execution
 */
export const globalExpectationsSchema = z.object({
  no_console_errors: z.boolean().optional(),
  no_network_errors: z.boolean().optional(),
  max_action_duration_ms: z.number().int().min(0).optional(),
  max_total_duration_ms: z.number().int().min(0).optional(),
  allow_partial_matches: z.boolean().optional(),
  min_confidence_threshold: z
    .number()
    .min(0.0, "Confidence threshold must be at least 0.0")
    .max(1.0, "Confidence threshold must be at most 1.0")
    .optional(),
});

/**
 * Base success criteria with common fields
 */
const baseSuccessCriteriaSchema = z.object({
  description: z.string().optional(),
});

/**
 * All actions must pass
 */
export const allActionsPassCriteriaSchema = baseSuccessCriteriaSchema.extend({
  type: z.literal("all_actions_pass"),
});

/**
 * Minimum number of pattern matches required
 */
export const minMatchesCriteriaSchema = baseSuccessCriteriaSchema.extend({
  type: z.literal("min_matches"),
  min_matches: z.number().int().min(0, "Minimum matches must be non-negative"),
});

/**
 * Maximum number of failures allowed
 */
export const maxFailuresCriteriaSchema = baseSuccessCriteriaSchema.extend({
  type: z.literal("max_failures"),
  max_failures: z
    .number()
    .int()
    .min(0, "Maximum failures must be non-negative"),
});

/**
 * Specific checkpoint(s) must pass
 */
export const checkpointPassedCriteriaSchema = baseSuccessCriteriaSchema.extend({
  type: z.literal("checkpoint_passed"),
  checkpoint_name: z.string().optional(),
  checkpoints: z.array(z.string().min(1)).optional(),
});

/**
 * Specific states must be visited during workflow
 */
export const requiredStatesCriteriaSchema = baseSuccessCriteriaSchema.extend({
  type: z.literal("required_states"),
  required_states: z
    .array(z.string().min(1, "State name cannot be empty"))
    .min(1, "At least one required state must be specified"),
});

/**
 * Custom expression for success evaluation
 */
export const customCriteriaSchema = baseSuccessCriteriaSchema.extend({
  type: z.literal("custom"),
  custom_expression: z.string().min(1, "Custom expression is required"),
});

/**
 * Union of all success criteria types
 */
export const successCriteriaSchema = z.discriminatedUnion("type", [
  allActionsPassCriteriaSchema,
  minMatchesCriteriaSchema,
  maxFailuresCriteriaSchema,
  checkpointPassedCriteriaSchema,
  requiredStatesCriteriaSchema,
  customCriteriaSchema,
]);

/**
 * Default settings for action-level expectations
 */
export const actionDefaultsSchema = z.object({
  is_terminal_on_failure: z.boolean().optional(),
  capture_checkpoint_on_failure: z.boolean().optional(),
  capture_checkpoint_after: z.boolean().optional(),
  max_retries: z.number().int().min(0).optional(),
  retry_delay_ms: z.number().int().min(0).optional(),
});

/**
 * Expectations that can be attached to individual actions
 */
export const actionExpectationsSchema = z.object({
  is_terminal_on_failure: z.boolean().optional(),
  capture_checkpoint_on_failure: z.boolean().optional(),
  capture_checkpoint_after: z.boolean().optional(),
  checkpoint_name: z.string().optional(),
  max_retries: z.number().int().min(0).optional(),
  retry_delay_ms: z.number().int().min(0).optional(),
  max_duration_ms: z.number().int().min(0).optional(),
  expected_state_after: z.string().optional(),
});

/**
 * Complete expectations configuration for a workflow
 */
export const workflowExpectationsSchema = z.object({
  global: globalExpectationsSchema.optional(),
  checkpoints: z.record(z.string(), checkpointDefinitionSchema).optional(),
  success_criteria: successCriteriaSchema.optional(),
  action_defaults: actionDefaultsSchema.optional(),
});

/**
 * Additional validation for text count assertions (use after discriminated union parsing)
 */
export const validateTextCountAssertion = (data: {
  count?: number;
  min_count?: number;
  max_count?: number;
}) => {
  // Must have either count OR (min_count and/or max_count)
  const hasCount = data.count !== undefined;
  const hasBounds =
    data.min_count !== undefined || data.max_count !== undefined;
  if (hasCount === hasBounds) {
    throw new Error(
      "Either 'count' or 'min_count'/'max_count' must be specified, but not both"
    );
  }
  // If both min and max are specified, min must be <= max
  if (data.min_count !== undefined && data.max_count !== undefined) {
    if (data.min_count > data.max_count) {
      throw new Error("min_count must be less than or equal to max_count");
    }
  }
};

/**
 * Additional validation for checkpoint passed criteria (use after discriminated union parsing)
 */
export const validateCheckpointPassedCriteria = (data: {
  checkpoint_name?: string;
  checkpoints?: string[];
}) => {
  // Must have either checkpoint_name OR checkpoints, but not both
  const hasName = data.checkpoint_name !== undefined;
  const hasArray =
    data.checkpoints !== undefined && data.checkpoints.length > 0;
  if (hasName === hasArray) {
    throw new Error(
      "Either 'checkpoint_name' or 'checkpoints' must be specified, but not both"
    );
  }
};

/**
 * Validation result for a checkpoint
 */
export const assertionResultSchema = z.object({
  type: z.enum([
    "text_present",
    "text_absent",
    "no_duplicate_matches",
    "text_count",
    "text_in_region",
  ]),
  pattern: z.string(),
  passed: z.boolean(),
  description: z.string().optional(),
  actual_value: z.unknown().optional(),
  expected_value: z.unknown().optional(),
  error: z.string().optional(),
});

/**
 * Result of a Claude review
 */
export const claudeReviewResultSchema = z.object({
  instruction: z.string(),
  passed: z.boolean(),
  observations: z.string(),
  confidence: z.number().min(0.0).max(1.0).optional(),
});

/**
 * Checkpoint validation result
 */
export const checkpointValidationResultSchema = z.object({
  checkpoint_name: z.string(),
  passed: z.boolean(),
  assertion_results: z.array(assertionResultSchema),
  screenshot_path: z.string().optional(),
  claude_review_results: z.array(claudeReviewResultSchema).optional(),
  duration_ms: z.number().min(0),
  error: z.string().optional(),
});

/**
 * Overall workflow execution result with expectations
 */
export const workflowExecutionResultSchema = z.object({
  success: z.boolean(),
  success_criteria: successCriteriaSchema.optional(),
  checkpoint_results: z.array(checkpointValidationResultSchema),
  actions_passed: z.number().int().min(0),
  actions_failed: z.number().int().min(0),
  total_duration_ms: z.number().min(0),
  exceeded_max_duration: z.boolean(),
  console_errors: z.array(z.string()).optional(),
  network_errors: z.array(z.string()).optional(),
  states_visited: z.array(z.string()),
  error: z.string().optional(),
});

// Export type inference helpers
export type ScreenRegion = z.infer<typeof screenRegionSchema>;
export type TextPresentAssertion = z.infer<typeof textPresentAssertionSchema>;
export type TextAbsentAssertion = z.infer<typeof textAbsentAssertionSchema>;
export type NoDuplicateMatchesAssertion = z.infer<
  typeof noDuplicateMatchesAssertionSchema
>;
export type TextCountAssertion = z.infer<typeof textCountAssertionSchema>;
export type TextInRegionAssertion = z.infer<typeof textInRegionAssertionSchema>;
export type OcrAssertion = z.infer<typeof ocrAssertionSchema>;
export type CheckpointDefinition = z.infer<typeof checkpointDefinitionSchema>;
export type GlobalExpectations = z.infer<typeof globalExpectationsSchema>;
export type AllActionsPassCriteria = z.infer<
  typeof allActionsPassCriteriaSchema
>;
export type MinMatchesCriteria = z.infer<typeof minMatchesCriteriaSchema>;
export type MaxFailuresCriteria = z.infer<typeof maxFailuresCriteriaSchema>;
export type CheckpointPassedCriteria = z.infer<
  typeof checkpointPassedCriteriaSchema
>;
export type RequiredStatesCriteria = z.infer<
  typeof requiredStatesCriteriaSchema
>;
export type CustomCriteria = z.infer<typeof customCriteriaSchema>;
export type SuccessCriteria = z.infer<typeof successCriteriaSchema>;
export type ActionDefaults = z.infer<typeof actionDefaultsSchema>;
export type ActionExpectations = z.infer<typeof actionExpectationsSchema>;
export type WorkflowExpectations = z.infer<typeof workflowExpectationsSchema>;
export type AssertionResult = z.infer<typeof assertionResultSchema>;
export type ClaudeReviewResult = z.infer<typeof claudeReviewResultSchema>;
export type CheckpointValidationResult = z.infer<
  typeof checkpointValidationResultSchema
>;
export type WorkflowExecutionResult = z.infer<
  typeof workflowExecutionResultSchema
>;
