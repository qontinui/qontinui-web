/**
 * Search options - used by actions that search for targets on screen
 */

import { Region, SearchStrategy, Coordinates } from "./common-types";

export interface SearchOptions {
  /** Similarity threshold (0.0-1.0) for image matching */
  similarity?: number;

  /** Maximum time to search for target (milliseconds) */
  timeout?: number;

  /** Specific regions to search within */
  searchRegions?: Region[];

  /** Search strategy to use */
  strategy?: SearchStrategy;

  /** Use only defined regions, don't search entire screen */
  useDefinedRegion?: boolean;

  /** Maximum number of matches to act on */
  maxMatchesToActOn?: number;

  /** Minimum matches required for success */
  minMatches?: number;

  /** Maximum matches to return */
  maxMatches?: number;

  /** Polling configuration */
  polling?: {
    /** Time between search attempts (milliseconds) */
    interval?: number;
    /** Maximum number of attempts */
    maxAttempts?: number;
  };

  /** Pattern matching options for template matching */
  pattern?: PatternOptions;

  /** Match adjustment options */
  adjustment?: MatchAdjustment;

  /** Capture image of match for logging */
  captureImage?: boolean;
}

/**
 * Advanced pattern matching options
 */
export interface PatternOptions {
  matchMethod?:
    | "CORRELATION"
    | "CORRELATION_NORMED"
    | "SQUARED_DIFFERENCE"
    | "SQUARED_DIFFERENCE_NORMED";
  scaleInvariant?: boolean;
  rotationInvariant?: boolean;
  minScale?: number;
  maxScale?: number;
  scaleStep?: number;
  minRotation?: number;
  maxRotation?: number;
  rotationStep?: number;
  useGrayscale?: boolean;
  useColorReduction?: boolean;
  colorTolerance?: number;
  useEdges?: boolean;
  edgeThreshold1?: number;
  edgeThreshold2?: number;
  nonMaxSuppression?: boolean;
  nmsThreshold?: number;
  minDistanceBetweenMatches?: number;
}

/**
 * Match adjustment - modify the matched region
 */
export interface MatchAdjustment {
  /** Target position within the match (e.g., 'CENTER', 'TOP_LEFT') */
  targetPosition?: string;
  /** Pixel offset from target position */
  targetOffset?: Coordinates;
  /** Pixels to add to width */
  addW?: number;
  /** Pixels to add to height */
  addH?: number;
  /** Absolute width override */
  absoluteW?: number;
  /** Absolute height override */
  absoluteH?: number;
  /** Pixels to add to X coordinate */
  addX?: number;
  /** Pixels to add to Y coordinate */
  addY?: number;
}
