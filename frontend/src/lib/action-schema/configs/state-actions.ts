/**
 * State management action configurations
 */

/**
 * GO_TO_STATE - Navigate to a specific state
 */
export interface GoToStateActionConfig {
  /** State ID to navigate to */
  stateId: string;

  /** Maximum time to wait for state transition (milliseconds) */
  timeout?: number;

  /** Verify state was reached */
  verify?: boolean;
}

/**
 * RUN_PROCESS - Execute another process
 */
export interface RunProcessActionConfig {
  /** Process ID to execute */
  processId: string;

  /** Pass variables to the process */
  variables?: Record<string, any>;

  /** Process repetition options */
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

  /** Store process result in variable */
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
