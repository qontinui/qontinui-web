/**
 * TypeScript types for Qontinui Workflow Expectations
 *
 * These types correspond to the expectations-schema.json JSON Schema.
 * Use these types in qontinui-web frontend for type-safe expectation handling.
 *
 * @module expectations-types
 */

/**
 * Screen region for OCR operations
 */
export interface ScreenRegion {
  /** X coordinate of top-left corner (pixels) */
  x: number;
  /** Y coordinate of top-left corner (pixels) */
  y: number;
  /** Width of region (pixels) */
  width: number;
  /** Height of region (pixels) */
  height: number;
}

/**
 * Type of OCR assertion to perform
 */
export type OcrAssertionType =
  | "text_present" // Check if text exists anywhere
  | "text_absent" // Check if text does NOT exist
  | "no_duplicate_matches" // Pattern should match at most once
  | "text_count" // Exact or bounded count of matches
  | "text_in_region"; // Text must appear in specific region

/**
 * Base OCR assertion with common fields
 */
interface BaseOcrAssertion {
  /** Type of OCR assertion */
  type: OcrAssertionType;
  /** Text pattern to search for (supports regex) */
  pattern: string;
  /** If true, pattern is treated as a regular expression */
  regex?: boolean;
  /** If true, text matching is case-sensitive */
  case_sensitive?: boolean;
  /** Human-readable description of what this assertion checks */
  description?: string;
  /** If true, failure of this assertion immediately fails the checkpoint */
  is_critical?: boolean;
}

/**
 * Assertion that text must be present
 */
export interface TextPresentAssertion extends BaseOcrAssertion {
  type: "text_present";
}

/**
 * Assertion that text must be absent
 */
export interface TextAbsentAssertion extends BaseOcrAssertion {
  type: "text_absent";
}

/**
 * Assertion that pattern should not match more than once
 */
export interface NoDuplicateMatchesAssertion extends BaseOcrAssertion {
  type: "no_duplicate_matches";
}

/**
 * Assertion that checks exact or bounded count of matches
 */
export interface TextCountAssertion extends BaseOcrAssertion {
  type: "text_count";
  /** Exact expected count (mutually exclusive with min_count/max_count) */
  count?: number;
  /** Minimum expected count */
  min_count?: number;
  /** Maximum expected count */
  max_count?: number;
}

/**
 * Assertion that text must appear in a specific screen region
 */
export interface TextInRegionAssertion extends BaseOcrAssertion {
  type: "text_in_region";
  /** Screen region to limit the OCR search */
  region: ScreenRegion;
}

/**
 * Union type of all OCR assertion types
 */
export type OcrAssertion =
  | TextPresentAssertion
  | TextAbsentAssertion
  | NoDuplicateMatchesAssertion
  | TextCountAssertion
  | TextInRegionAssertion;

/**
 * Named checkpoint with assertions and validation rules
 */
export interface CheckpointDefinition {
  /** Array of OCR-based text validation checks */
  ocr_assertions?: OcrAssertion[];
  /** Natural language instructions for Claude to review the checkpoint screenshot */
  claude_review?: string[];
  /** If true, a screenshot must be captured at this checkpoint */
  screenshot_required?: boolean;
  /** Maximum time to wait for checkpoint assertions to pass (ms) */
  max_wait_ms?: number;
  /** Time between assertion retry attempts (ms) */
  retry_interval_ms?: number;
  /** Human-readable description of what this checkpoint validates */
  description?: string;
}

/**
 * Global expectations that apply to entire workflow execution
 */
export interface GlobalExpectations {
  /** If true, any console errors will cause workflow to fail */
  no_console_errors?: boolean;
  /** If true, any network request failures (4xx/5xx) will cause workflow to fail */
  no_network_errors?: boolean;
  /** Maximum allowed duration for any single action (ms) */
  max_action_duration_ms?: number;
  /** Maximum allowed duration for entire workflow execution (ms) */
  max_total_duration_ms?: number;
  /** If false, all pattern matching must meet confidence threshold */
  allow_partial_matches?: boolean;
  /** Minimum confidence threshold (0.0 to 1.0) for pattern matching */
  min_confidence_threshold?: number;
}

/**
 * Type of success criteria
 */
export type SuccessCriteriaType =
  | "all_actions_pass" // All actions must complete successfully
  | "min_matches" // Minimum number of pattern matches required
  | "max_failures" // Maximum number of failures allowed
  | "checkpoint_passed" // Specific checkpoint(s) must pass
  | "required_states" // Specific states must be visited
  | "custom"; // Custom expression evaluation

/**
 * Base success criteria with common fields
 */
interface BaseSuccessCriteria {
  /** Type of success criteria */
  type: SuccessCriteriaType;
  /** Human-readable explanation of what constitutes success */
  description?: string;
}

/**
 * All actions must pass
 */
export interface AllActionsPassCriteria extends BaseSuccessCriteria {
  type: "all_actions_pass";
}

/**
 * Minimum number of pattern matches required
 */
export interface MinMatchesCriteria extends BaseSuccessCriteria {
  type: "min_matches";
  /** Minimum number of successful pattern matches */
  min_matches: number;
}

/**
 * Maximum number of failures allowed
 */
export interface MaxFailuresCriteria extends BaseSuccessCriteria {
  type: "max_failures";
  /** Maximum number of action failures allowed */
  max_failures: number;
}

/**
 * Specific checkpoint(s) must pass
 */
export interface CheckpointPassedCriteria extends BaseSuccessCriteria {
  type: "checkpoint_passed";
  /** Single checkpoint name that must pass */
  checkpoint_name?: string;
  /** Array of checkpoint names that must all pass */
  checkpoints?: string[];
}

/**
 * Specific states must be visited during workflow
 */
export interface RequiredStatesCriteria extends BaseSuccessCriteria {
  type: "required_states";
  /** Array of state names that must be visited */
  required_states: string[];
}

/**
 * Custom expression for success evaluation
 */
export interface CustomCriteria extends BaseSuccessCriteria {
  type: "custom";
  /** Custom expression for success evaluation */
  custom_expression: string;
}

/**
 * Union type of all success criteria
 */
export type SuccessCriteria =
  | AllActionsPassCriteria
  | MinMatchesCriteria
  | MaxFailuresCriteria
  | CheckpointPassedCriteria
  | RequiredStatesCriteria
  | CustomCriteria;

/**
 * Default settings for action-level expectations
 */
export interface ActionDefaults {
  /** If true, action failure stops workflow execution immediately */
  is_terminal_on_failure?: boolean;
  /** If true, automatically capture checkpoint when action fails */
  capture_checkpoint_on_failure?: boolean;
  /** If true, automatically capture checkpoint after action succeeds */
  capture_checkpoint_after?: boolean;
  /** Number of times to retry a failed action */
  max_retries?: number;
  /** Time to wait between retry attempts (ms) */
  retry_delay_ms?: number;
}

/**
 * Expectations that can be attached to individual actions
 */
export interface ActionExpectations {
  /** If true, action failure stops workflow execution immediately */
  is_terminal_on_failure?: boolean;
  /** If true, automatically capture checkpoint when this action fails */
  capture_checkpoint_on_failure?: boolean;
  /** If true, automatically capture checkpoint after this action succeeds */
  capture_checkpoint_after?: boolean;
  /** Name of checkpoint to create (if capture_checkpoint_* is true) */
  checkpoint_name?: string;
  /** Number of times to retry this action if it fails */
  max_retries?: number;
  /** Time to wait between retry attempts for this action (ms) */
  retry_delay_ms?: number;
  /** Maximum allowed duration for this specific action (ms) */
  max_duration_ms?: number;
  /** The state that should be active after this action completes */
  expected_state_after?: string;
}

/**
 * Complete expectations configuration for a workflow
 */
export interface WorkflowExpectations {
  /** Global expectations for entire workflow */
  global?: GlobalExpectations;
  /** Named checkpoints with validation rules */
  checkpoints?: Record<string, CheckpointDefinition>;
  /** Success criteria for the workflow */
  success_criteria?: SuccessCriteria;
  /** Default settings for all actions */
  action_defaults?: ActionDefaults;
}

/**
 * Type guard to check if success criteria is MinMatchesCriteria
 */
export function isMinMatchesCriteria(
  criteria: SuccessCriteria
): criteria is MinMatchesCriteria {
  return criteria.type === "min_matches";
}

/**
 * Type guard to check if success criteria is MaxFailuresCriteria
 */
export function isMaxFailuresCriteria(
  criteria: SuccessCriteria
): criteria is MaxFailuresCriteria {
  return criteria.type === "max_failures";
}

/**
 * Type guard to check if success criteria is CheckpointPassedCriteria
 */
export function isCheckpointPassedCriteria(
  criteria: SuccessCriteria
): criteria is CheckpointPassedCriteria {
  return criteria.type === "checkpoint_passed";
}

/**
 * Type guard to check if success criteria is RequiredStatesCriteria
 */
export function isRequiredStatesCriteria(
  criteria: SuccessCriteria
): criteria is RequiredStatesCriteria {
  return criteria.type === "required_states";
}

/**
 * Type guard to check if success criteria is CustomCriteria
 */
export function isCustomCriteria(
  criteria: SuccessCriteria
): criteria is CustomCriteria {
  return criteria.type === "custom";
}

/**
 * Type guard to check if OCR assertion is TextCountAssertion
 */
export function isTextCountAssertion(
  assertion: OcrAssertion
): assertion is TextCountAssertion {
  return assertion.type === "text_count";
}

/**
 * Type guard to check if OCR assertion is TextInRegionAssertion
 */
export function isTextInRegionAssertion(
  assertion: OcrAssertion
): assertion is TextInRegionAssertion {
  return assertion.type === "text_in_region";
}

/**
 * Validation result for a checkpoint
 */
export interface CheckpointValidationResult {
  /** Name of the checkpoint */
  checkpoint_name: string;
  /** Whether the checkpoint passed all assertions */
  passed: boolean;
  /** Individual assertion results */
  assertion_results: AssertionResult[];
  /** Screenshot path if captured */
  screenshot_path?: string;
  /** Claude review results if performed */
  claude_review_results?: ClaudeReviewResult[];
  /** Total time taken to validate (ms) */
  duration_ms: number;
  /** Error message if checkpoint failed */
  error?: string;
}

/**
 * Result of a single assertion
 */
export interface AssertionResult {
  /** Type of assertion */
  type: OcrAssertionType;
  /** Pattern that was checked */
  pattern: string;
  /** Whether the assertion passed */
  passed: boolean;
  /** Description of the assertion */
  description?: string;
  /** Actual value found (for debugging) */
  actual_value?: unknown;
  /** Expected value (for debugging) */
  expected_value?: unknown;
  /** Error message if assertion failed */
  error?: string;
}

/**
 * Result of a Claude review
 */
export interface ClaudeReviewResult {
  /** The instruction that was given to Claude */
  instruction: string;
  /** Whether Claude found issues */
  passed: boolean;
  /** Claude's observations */
  observations: string;
  /** Confidence in the review (0.0 to 1.0) */
  confidence?: number;
}

/**
 * Overall workflow execution result with expectations
 */
export interface WorkflowExecutionResult {
  /** Whether the workflow succeeded according to success criteria */
  success: boolean;
  /** Success criteria that was evaluated */
  success_criteria?: SuccessCriteria;
  /** Checkpoint validation results */
  checkpoint_results: CheckpointValidationResult[];
  /** Number of actions that passed */
  actions_passed: number;
  /** Number of actions that failed */
  actions_failed: number;
  /** Total execution time (ms) */
  total_duration_ms: number;
  /** Whether execution exceeded max_total_duration_ms */
  exceeded_max_duration: boolean;
  /** Console errors encountered (if no_console_errors was true) */
  console_errors?: string[];
  /** Network errors encountered (if no_network_errors was true) */
  network_errors?: string[];
  /** States that were visited */
  states_visited: string[];
  /** Overall error message if workflow failed */
  error?: string;
}

/**
 * Default values for various expectation settings
 */
export const EXPECTATION_DEFAULTS = {
  /** Default checkpoint screenshot requirement */
  SCREENSHOT_REQUIRED: true,
  /** Default max wait time for checkpoint assertions (ms) */
  MAX_WAIT_MS: 5000,
  /** Default retry interval for checkpoint assertions (ms) */
  RETRY_INTERVAL_MS: 500,
  /** Default terminal on failure setting */
  IS_TERMINAL_ON_FAILURE: true,
  /** Default capture checkpoint on failure setting */
  CAPTURE_CHECKPOINT_ON_FAILURE: false,
  /** Default capture checkpoint after success setting */
  CAPTURE_CHECKPOINT_AFTER: false,
  /** Default max retries for actions */
  MAX_RETRIES: 0,
  /** Default retry delay (ms) */
  RETRY_DELAY_MS: 1000,
  /** Default min confidence threshold */
  MIN_CONFIDENCE_THRESHOLD: 0.8,
  /** Default allow partial matches setting */
  ALLOW_PARTIAL_MATCHES: true,
  /** Default no console errors setting */
  NO_CONSOLE_ERRORS: false,
  /** Default no network errors setting */
  NO_NETWORK_ERRORS: false,
  /** Default OCR assertion criticality */
  IS_CRITICAL: true,
  /** Default regex setting for OCR assertions */
  REGEX: false,
  /** Default case sensitivity for OCR assertions */
  CASE_SENSITIVE: false,
} as const;
