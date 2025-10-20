/**
 * Target configuration - used by actions that need to locate something on screen
 */

import { Region, Coordinates } from './common-types';
import { SearchOptions } from './search-options';

export type TargetType = 'image' | 'region' | 'text' | 'coordinates' | 'stateString';

export interface ImageTarget {
  type: 'image';
  imageId: string;
  searchOptions?: SearchOptions;
}

export interface RegionTarget {
  type: 'region';
  region: Region;
}

export interface TextTarget {
  type: 'text';
  text: string;
  searchOptions?: SearchOptions;
  textOptions?: TextSearchOptions;
}

export interface CoordinatesTarget {
  type: 'coordinates';
  coordinates: Coordinates;
}

export interface StateStringTarget {
  type: 'stateString';
  stateId: string;
  stringIds: string[];
  useAll?: boolean;
}

export type TargetConfig =
  | ImageTarget
  | RegionTarget
  | TextTarget
  | CoordinatesTarget
  | StateStringTarget;

/**
 * Text search options for OCR-based finding
 */
export interface TextSearchOptions {
  ocrEngine?: 'TESSERACT' | 'EASYOCR' | 'PADDLEOCR' | 'NATIVE';
  language?: string;
  whitelistChars?: string;
  blacklistChars?: string;
  matchType?: 'EXACT' | 'CONTAINS' | 'STARTS_WITH' | 'ENDS_WITH' | 'REGEX' | 'FUZZY';
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
