/**
 * State management action configurations
 */

/**
 * GO_TO_STATE - Navigate to one or more target states
 *
 * Supports pathfinding to multiple target states. The runner will find the optimal
 * path to reach all specified states, executing transitions that may activate
 * additional states along the way.
 *
 * Example: If there's a transition A -> {B,C}, then GO_TO_STATE([B]) from A
 * will execute that transition, activating both B and C.
 */
export interface GoToStateActionConfig {
  /** State ID(s) to navigate to - supports both single state and multiple states */
  stateIds: string[];

  /** Maximum time to wait for state transition (milliseconds) */
  timeout?: number;

  /** Verify state(s) were reached */
  verify?: boolean;

  /** Strategy for pathfinding to multiple states */
  strategy?: "all" | "any" | "optimal";
}

/**
 * RUN_WORKFLOW - Execute another workflow
 */
export interface RunWorkflowActionConfig {
  /** Workflow ID to execute */
  workflowId: string;

  /** Pass variables to the workflow */
  variables?: Record<string, any>;

  /** Workflow repetition options */
  repetition?: {
    /** Enable repetition */
    enabled: boolean;
    /** Maximum number of repeats (1 = run once more, 2 = run twice more, etc.) */
    maxRepeats: number;
    /** Delay between repeats (milliseconds) */
    delay?: number;
    /** If true: stop on first success. If false: always run maxRepeats times */
    untilSuccess?: boolean;
  };

  /** Store workflow result in variable */
  outputVariable?: string;
}

/**
 * SCREENSHOT - Capture a screenshot
 */
export interface ScreenshotActionConfig {
  /** Region to capture (if not specified, captures entire screen) */
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  /** Variable name to store screenshot data */
  outputVariable?: string;

  /** Save to file */
  saveToFile?: {
    enabled: boolean;
    filename?: string;
    directory?: string;
  };
}
