/**
 * Find action configurations
 */

import { TargetConfig } from "../shared/target-config";
import { SearchOptions } from "../shared/search-options";

/**
 * FIND - Search for a target on screen
 */
export interface FindActionConfig {
  target: TargetConfig;
  searchOptions?: SearchOptions;
}

/**
 * FIND_STATE_IMAGE - Find an image associated with a state
 */
export interface FindStateImageActionConfig {
  stateId: string;
  imageId: string;
  searchOptions?: SearchOptions;
}

/**
 * VANISH - Wait for a target to disappear
 */
export interface VanishActionConfig {
  target: TargetConfig;
  maxWaitTime?: number; // milliseconds
  pollInterval?: number; // milliseconds
}

/**
 * EXISTS - Check if a target exists without waiting
 */
export interface ExistsActionConfig {
  target: TargetConfig;
  searchOptions?: SearchOptions;
  /** Variable name to store boolean result */
  outputVariable?: string;
}

/**
 * WAIT - Wait for a condition or time
 */
export interface WaitActionConfig {
  /** What to wait for */
  waitFor: "time" | "target" | "state" | "condition";

  /** Wait duration (milliseconds) - for 'time' mode */
  duration?: number;

  /** Target to wait for - for 'target' mode */
  target?: TargetConfig;

  /** State to wait for - for 'state' mode */
  stateId?: string;

  /** Custom condition - for 'condition' mode */
  condition?: {
    type: "javascript" | "variable";
    expression: string;
  };

  /** Check interval for target/state/condition (milliseconds) */
  checkInterval?: number;

  /** Maximum time to wait (milliseconds) */
  maxWaitTime?: number;

  /** Log progress while waiting */
  logProgress?: boolean;
}
