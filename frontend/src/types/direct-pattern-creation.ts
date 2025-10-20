/**
 * Types for Direct Pattern Creation (Experimental Feature)
 */

export interface ExtractedPattern {
  id: string;
  name: string;
  imageData: string; // Base64 data URL
  region: Region;
  sourceScreenshotIndex: number;
  sourceScreenshotUrl: string;
  sourceSnapshotId: string;
  states: string[];
  timestamp: string;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapshotScreenshot {
  id: string;
  url: string;
  path: string;
  snapshotRunId: string;
  snapshotName: string;
  active_states: string[];
  timestamp: string;
  width?: number;
  height?: number;
}

export interface PatternSaveResult {
  success: boolean;
  savedPatterns: number;
  errors: Array<{ patternId: string; error: string }>;
}
