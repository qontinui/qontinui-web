/**
 * Checkpoint Expectations Types
 *
 * Types for configuring test expectations at specific checkpoints
 * in workflow execution. Used for integration testing and validation.
 */

/**
 * Region bounds for text-in-region assertions
 */
export interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * OCR assertion types
 */
export type OCRAssertionType =
  | "text_present"
  | "text_absent"
  | "no_duplicate_matches"
  | "text_count"
  | "text_in_region";

/**
 * Individual OCR assertion configuration
 */
export interface OCRAssertion {
  id: string;
  type: OCRAssertionType;
  pattern: string; // Text pattern to search for
  isRegex?: boolean; // Whether pattern is a regex
  minCount?: number; // For text_count assertions
  maxCount?: number; // For text_count assertions
  region?: RegionBounds; // For text_in_region assertions
}

/**
 * Checkpoint expectation configuration
 */
export interface CheckpointExpectation {
  id: string;
  name: string; // Checkpoint name (e.g., "After Login", "Dashboard Loaded")
  ocrAssertions: OCRAssertion[]; // List of OCR-based assertions
  claudeReviewNotes: string[]; // Notes for Claude to review visually
  screenshotRequired: boolean; // Whether screenshot is required at this checkpoint
}
