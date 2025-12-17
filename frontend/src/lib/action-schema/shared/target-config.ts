/**
 * Target configuration - used by actions that need to locate something on screen
 */

import { Region, Coordinates } from "./common-types";
import { SearchOptions } from "./search-options";

/**
 * Valid target types that match qontinui-schemas TargetConfig.
 * Note: "stateImage" is deprecated - use "image" with imageIds instead.
 */
export type TargetType =
  | "image"
  | "stateImage" // @deprecated - use "image" with imageIds instead
  | "region"
  | "text"
  | "coordinates"
  | "stateString"
  | "currentPosition"
  | "lastFindResult"
  | "resultIndex"
  | "allResults"
  | "resultByImage";

export interface ImageTarget {
  type: "image";
  /** Single image ID (legacy format) */
  imageId?: string;
  /** Multiple image IDs (preferred format for multi-select) */
  imageIds?: string[];
  searchOptions?: SearchOptions;
}

/**
 * StateImageTarget - Find any image from a state definition
 * When selected, all images from the state are used for matching
 *
 * @deprecated This target type does not exist in qontinui-schemas.
 * Use ImageTarget with imageIds instead. This type is kept for backward
 * compatibility when reading legacy configs - it should be converted to
 * ImageTarget before saving.
 */
export interface StateImageTarget {
  type: "stateImage";
  stateId: string;
  /** Image IDs from the state - populated when state is selected */
  imageIds: string[];
  searchOptions?: SearchOptions;
}

export interface RegionTarget {
  type: "region";
  region: Region;
}

export interface TextTarget {
  type: "text";
  text: string;
  searchOptions?: SearchOptions;
  textOptions?: TextSearchOptions;
}

export interface CoordinatesTarget {
  type: "coordinates";
  coordinates: Coordinates;
}

export interface StateStringTarget {
  type: "stateString";
  stateId: string;
  stringIds: string[];
  useAll?: boolean;
}

export interface CurrentPositionTarget {
  type: "currentPosition";
}

/**
 * LastFindResultTarget - Use the location from the most recent FIND action.
 * This target type allows actions to reference the result of a previous FIND
 * action without knowing the exact coordinates at configuration time.
 */
export interface LastFindResultTarget {
  type: "lastFindResult";
}

/**
 * ResultIndexTarget - Reference a specific match by index from last FIND result
 * Used after a FIND action that returned multiple matches
 */
export interface ResultIndexTarget {
  type: "resultIndex";
  index: number;
}

/**
 * AllResultsTarget - Reference all matches from last FIND result
 * Primarily for multi-location actions; single-location actions use first match with warning
 */
export interface AllResultsTarget {
  type: "allResults";
}

/**
 * ResultByImageTarget - Reference match from specific image in multi-image FIND result
 * Used after a FIND action with multiple images (EACH strategy)
 */
export interface ResultByImageTarget {
  type: "resultByImage";
  imageId: string;
}

/**
 * Union of all valid target configurations.
 * Matches qontinui-schemas TargetConfig (excluding deprecated StateImageTarget).
 */
export type TargetConfig =
  | ImageTarget
  | StateImageTarget // @deprecated - kept for backward compatibility reading only
  | RegionTarget
  | TextTarget
  | CoordinatesTarget
  | StateStringTarget
  | CurrentPositionTarget
  | LastFindResultTarget
  | ResultIndexTarget
  | AllResultsTarget
  | ResultByImageTarget;

/**
 * Text search options for OCR-based finding
 */
export interface TextSearchOptions {
  ocrEngine?: "TESSERACT" | "EASYOCR" | "PADDLEOCR" | "NATIVE";
  language?: string;
  whitelistChars?: string;
  blacklistChars?: string;
  matchType?:
    | "EXACT"
    | "CONTAINS"
    | "STARTS_WITH"
    | "ENDS_WITH"
    | "REGEX"
    | "FUZZY";
  caseSensitive?: boolean;
  ignoreWhitespace?: boolean;
  normalizeUnicode?: boolean;
  fuzzyThreshold?: number;
  editDistance?: number;
  preprocessing?: string[];
  scaleFactor?: number;
  psmMode?: number;
  oemMode?: number;
  confidenceThreshold?: number;
}
