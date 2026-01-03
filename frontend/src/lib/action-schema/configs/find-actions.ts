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
 * FIND_STATE - Check which states are currently active on screen
 *
 * Performs a FIND ALL operation on the images of the selected states.
 * Returns which states have at least one image currently visible on screen.
 * This is useful for detecting the current application state before taking action.
 */
export interface FindStateActionConfig {
  /** Array of state IDs to check for visibility */
  stateIds: string[];

  /** Search options for image matching */
  searchOptions?: SearchOptions;

  /** Variable name to store the array of active state IDs */
  outputVariable?: string;
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
