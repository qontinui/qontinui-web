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

/**
 * RAG_FIND - Find element using RAG (Retrieval-Augmented Generation)
 * Uses vector embeddings (CLIP) for fast, semantic element matching
 */
export interface RagFindActionConfig {
  /** Target element to find (StateImage) */
  target: {
    type: "stateImage";
    stateImageId: string;
  };

  /** Optional OCR text filter */
  ocrFilter?: {
    text: string;
    matchMode: "exact" | "contains" | "regex";
    similarity?: number;
  };

  /** Number of matching locations to return (1-10) */
  topK?: number;

  /** Variable name to store results */
  outputVariable?: string;

  /** Similarity threshold override */
  similarityThreshold?: number;
}
