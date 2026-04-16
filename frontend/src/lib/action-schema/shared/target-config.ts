/**
 * Target configuration - used by actions that need to locate something on screen.
 *
 * This file imports types from @qontinui/shared-types/targets (the single source of truth)
 * and extends them with frontend-specific compatibility features.
 *
 * IMPORTANT: Target types use camelCase for the type discriminator:
 * - "stateImage" (lowercase 'i') - CORRECT
 * - "StateImage" (uppercase 'I') - LEGACY, deprecated
 */

// Import generated types from qontinui-schemas
import type {
  TargetType as GeneratedTargetType,
  ImageTarget as GeneratedImageTarget,
  RegionTarget as GeneratedRegionTarget,
  TextTarget as GeneratedTextTarget,
  CoordinatesTarget as GeneratedCoordinatesTarget,
  StateStringTarget as GeneratedStateStringTarget,
  StateRegionTarget,
  StateLocationTarget,
  StateImageTarget as GeneratedStateImageTarget,
  CurrentPositionTarget as GeneratedCurrentPositionTarget,
  LastFindResultTarget as GeneratedLastFindResultTarget,
  ResultIndexTarget as GeneratedResultIndexTarget,
  AllResultsTarget as GeneratedAllResultsTarget,
  ResultByImageTarget as GeneratedResultByImageTarget,
  SearchOptions as GeneratedSearchOptions,
  TextSearchOptions,
  PollingConfig,
  PatternOptions,
  MatchAdjustment,
} from "@qontinui/shared-types/targets";

// SearchStrategy enum - defined locally to avoid runtime dependency on @qontinui/schemas
// (which is not published to npm and unavailable in CI/Vercel builds).
// Must stay in sync with @qontinui/shared-types/targets SearchStrategy.
export enum SearchStrategy {
  FIRST = "FIRST",
  ALL = "ALL",
  BEST = "BEST",
  EACH = "EACH",
}

// Re-export types that don't need modification
export type {
  StateRegionTarget,
  StateLocationTarget,
  TextSearchOptions,
  PollingConfig,
  PatternOptions,
  MatchAdjustment,
};

/**
 * String literal version of SearchStrategy for backward compatibility.
 * Frontend code uses string literals like "FIRST" but the generated enum is SearchStrategy.FIRST.
 */
export type SearchStrategyValue = "FIRST" | "ALL" | "BEST" | "EACH";

// Re-export Region and Coordinates from common-types for backward compatibility
export type { Region, Coordinates } from "./common-types";

/**
 * Extended SearchOptions with backward compatibility for 'strategy' alias
 * and string literal values.
 * IMPORTANT: Define this BEFORE target types that reference it.
 */
export interface SearchOptions extends Omit<
  GeneratedSearchOptions,
  "searchStrategy"
> {
  /** Search strategy (alias for searchStrategy) - accepts both enum and string */
  strategy?: SearchStrategy | SearchStrategyValue | null;
  /** Search strategy (canonical name) - accepts both enum and string */
  searchStrategy?: SearchStrategy | SearchStrategyValue | null;
}

/**
 * Extended ImageTarget with backward compatibility for single imageId.
 * The generated type only has imageIds (array), but frontend code uses
 * both imageId (legacy) and imageIds (preferred).
 */
export interface ImageTarget extends Omit<
  GeneratedImageTarget,
  "imageIds" | "searchOptions"
> {
  type: "image";
  /** Single image ID (legacy format) */
  imageId?: string;
  /** Multiple image IDs (preferred format for multi-select) */
  imageIds?: string[];
  /** Search options with extended compatibility */
  searchOptions?: SearchOptions | null;
}

/**
 * Extended RegionTarget with required type.
 */
export interface RegionTarget extends GeneratedRegionTarget {
  type: "region";
}

/**
 * Extended TextTarget with required type and our SearchOptions.
 */
export interface TextTarget extends Omit<GeneratedTextTarget, "searchOptions"> {
  type: "text";
  searchOptions?: SearchOptions | null;
}

/**
 * Extended CoordinatesTarget with required type.
 */
export interface CoordinatesTarget extends GeneratedCoordinatesTarget {
  type: "coordinates";
}

/**
 * Extended StateStringTarget with required type.
 */
export interface StateStringTarget extends GeneratedStateStringTarget {
  type: "stateString";
}

/**
 * Extended StateImageTarget with required type.
 */
export interface StateImageTarget extends GeneratedStateImageTarget {
  type: "stateImage";
}

/**
 * Extended CurrentPositionTarget with required type.
 */
export interface CurrentPositionTarget extends GeneratedCurrentPositionTarget {
  type: "currentPosition";
}

/**
 * Extended LastFindResultTarget with required type.
 */
export interface LastFindResultTarget extends GeneratedLastFindResultTarget {
  type: "lastFindResult";
}

/**
 * Extended ResultIndexTarget with required type.
 */
export interface ResultIndexTarget extends GeneratedResultIndexTarget {
  type: "resultIndex";
}

/**
 * Extended AllResultsTarget with required type.
 */
export interface AllResultsTarget extends GeneratedAllResultsTarget {
  type: "allResults";
}

/**
 * Extended ResultByImageTarget with required type.
 */
export interface ResultByImageTarget extends GeneratedResultByImageTarget {
  type: "resultByImage";
}

/**
 * Valid target types - same as generated.
 */
export type TargetType = GeneratedTargetType;

/**
 * Union of all valid target configurations (with frontend extensions).
 */
export type TargetConfig =
  | ImageTarget
  | RegionTarget
  | TextTarget
  | CoordinatesTarget
  | StateStringTarget
  | StateRegionTarget
  | StateLocationTarget
  | StateImageTarget
  | CurrentPositionTarget
  | LastFindResultTarget
  | ResultIndexTarget
  | AllResultsTarget
  | ResultByImageTarget;
