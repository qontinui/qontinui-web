/**
 * Workflow Testing Types
 *
 * Type definitions for the workflow testing framework including
 * test cases, suites and assertions.
 */

// ============================================================================
// Assertion Types
// ============================================================================

export type AssertionType =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "exists"
  | "notExists"
  | "greaterThan"
  | "lessThan"
  | "regex"
  | "custom";

export interface Assertion {
  /** Unique assertion ID */
  id: string;

  /** Type of assertion */
  type: AssertionType;

  /** Description of what is being asserted */
  description?: string;

  /** Path to the value being tested (e.g., 'variables.username') */
  path?: string;

  /** Expected value for comparison assertions */
  expected?: unknown;

  /** Regex pattern for regex assertions */
  pattern?: string;

  /** Custom function as string for custom assertions */
  customFunction?: string;
}

// ============================================================================
// Test Case Types
// ============================================================================

export interface TestCaseConfig {
  /** Input variables for the workflow */
  inputs?: Record<string, unknown>;

  /** Initial state setup */
  initialState?: {
    variables?: Record<string, unknown>;
    screenshots?: string[];
    activeStates?: string[];
  };

  /** Assertions to evaluate after execution */
  assertions: Assertion[];

  /** Expected execution behavior */
  expected?: {
    /** Should the workflow succeed? */
    shouldSucceed?: boolean;

    /** Expected final action reached */
    finalActionId?: string;

    /** Expected path of action IDs */
    actionPath?: string[];

    /** Maximum execution time in milliseconds */
    maxDuration?: number;
  };

  /** Timeout for test execution in milliseconds */
  timeout?: number;

  /** Tags for categorization */
  tags?: string[];
}

export interface TestCase {
  /** Unique test case ID */
  id: string;

  /** Human-readable test name */
  name: string;

  /** Description of what this test validates */
  description?: string;

  /** Workflow ID being tested */
  workflowId: string;

  /** Test configuration */
  config: TestCaseConfig;

  /** Metadata */
  metadata?: {
    created?: string;
    updated?: string;
    author?: string;
    [key: string]: unknown;
  };

  /** Enabled/disabled status */
  enabled?: boolean;
}

// ============================================================================
// Test Suite Types
// ============================================================================

export interface TestSuite {
  /** Unique suite ID */
  id: string;

  /** Suite name */
  name: string;

  /** Suite description */
  description?: string;

  /** Test case IDs in this suite */
  testCaseIds: string[];

  /** Execution order preference */
  executionOrder?: "parallel" | "sequential";

  /** Stop on first failure */
  stopOnFailure?: boolean;

  /** Metadata */
  metadata?: {
    created?: string;
    updated?: string;
    author?: string;
    [key: string]: unknown;
  };

  /** Tags for categorization */
  tags?: string[];
}
