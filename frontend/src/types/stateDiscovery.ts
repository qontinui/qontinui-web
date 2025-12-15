/**
 * TypeScript types for State Discovery
 */

export interface StateImage {
  id: string;
  name: string;
  x: number;
  y: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
  pixelHash: string;
  stabilityScore: number; // 1.0 = perfect pixel match when present
  screenshots: string[]; // List of screenshots where this appears
  createdAt: string;
  tags?: string[];
  darkPixelPercentage?: number; // Now calculated only for active mask pixels
  lightPixelPercentage?: number; // Now calculated only for active mask pixels
  avgBrightness?: number;
  maskDensity?: number; // Percentage of active pixels in mask (1.0 = full rectangle)
  hasMask?: boolean; // Whether this StateImage has a custom mask
  frequency?: number; // Frequency of appearance across screenshots (0.0-1.0)
  image_data?: string; // Base64 encoded image data
}

export interface DiscoveredState {
  id: string;
  name: string;
  stateImageIds: string[]; // Changed from stateImages to match backend
  screenshotIds: string[]; // Changed from screenshots to match backend
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface StateTransition {
  fromState: string;
  toState: string;
  triggerImage?: string;
  confidence: number;
}

export interface AnalysisConfig {
  minRegionSize: [number, number];
  maxRegionSize: [number, number];
  colorTolerance: number;
  stabilityThreshold: number;
  varianceThreshold: number;
  minScreenshotsPresent: number;
  processingMode: "full" | "quick" | "custom";
  enableRectangleDecomposition: boolean;
  enableCooccurrenceAnalysis: boolean;
  similarityThreshold?: number;
  region?: { x: number; y: number; width: number; height: number };
}

export interface AnalysisResult {
  states: DiscoveredState[];
  stateImages: StateImage[];
  transitions: StateTransition[];
  statistics: {
    totalScreenshots: number;
    statesFound: number;
    stateImagesFound: number;
    averageStateImagesPerState: number;
    pixelStabilityScore: number;
    stablePixelCount: number;
    totalPixelCount: number;
  };
}

export interface DeletionImpact {
  stateImage: StateImage;
  statesAffected: number;
  affectedStates: string[];
  willCreateOrphans: boolean;
  orphanedStates: string[];
  isCritical: boolean;
  isFrequentlyUsed: boolean;
  recommendations: string[];
}

export interface DeleteOptions {
  cascade?: boolean;
  force?: boolean;
  skipConfirmation?: boolean;
  handleOrphans?: "delete" | "keep" | "merge";
}

export interface DeleteResult {
  deleted: string[];
  skipped: Array<{ id: string; reason: string }>;
  affectedStates: string[];
  orphanedStates: string[];
  warnings: string[];
  undoId?: string;
}

export interface UploadResponse {
  uploadId: string;
  projectId: string;
  screenshots: Array<{
    id: string;
    filename: string;
    size: number;
    dimensions: { width: number; height: number };
  }>;
  totalSize: number;
  count: number;
}

export interface AnalysisProgress {
  stage: "pixel_analysis" | "region_extraction" | "state_assembly" | "complete";
  percentage: number;
  currentScreenshot?: number;
  totalScreenshots?: number;
  message: string;
}
