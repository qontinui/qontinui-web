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
