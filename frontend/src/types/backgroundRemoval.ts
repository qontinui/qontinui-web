/**
 * TypeScript types for Background Removal
 */

export interface BackgroundRemovalConfig {
  // Detection strategies
  useTemporalVariance: boolean;
  useEdgeDensity: boolean;
  useUniformity: boolean;

  // Temporal variance thresholds
  varianceThreshold: number;
  minScreenshotsForVariance: number;

  // Edge density thresholds
  edgeDensityThreshold: number;
  edgeKernelSize: number;

  // Uniformity thresholds
  uniformityThreshold: number;
  uniformityRegionSize: number;

  // Morphological operations
  applyMorphology: boolean;
  morphologyKernelSize: number;
  minForegroundRegionSize: number;

  // Output format
  foregroundAlpha: number;
  backgroundAlpha: number;
}

export interface BackgroundRemovalStatistics {
  totalPixels: number;
  backgroundPixels: number;
  foregroundPixels: number;
  backgroundPercentage: number;
  foregroundPercentage: number;
  numScreenshots: number;
  imageSize: [number, number];
}

export interface BackgroundRemovalResult {
  maskedScreenshots: string[]; // Base64 RGBA data URLs
  statistics: BackgroundRemovalStatistics;
  backgroundMask?: string; // Base64 grayscale mask (debug mode)
}

export interface BackgroundRemovalRequest {
  screenshotIds: string[];
  config: BackgroundRemovalConfig;
  debug?: boolean;
}

// Default configuration matching Python defaults
export const DEFAULT_BACKGROUND_REMOVAL_CONFIG: BackgroundRemovalConfig = {
  useTemporalVariance: true,
  useEdgeDensity: true,
  useUniformity: true,
  varianceThreshold: 20.0,
  minScreenshotsForVariance: 3,
  edgeDensityThreshold: 0.05,
  edgeKernelSize: 3,
  uniformityThreshold: 15.0,
  uniformityRegionSize: 20,
  applyMorphology: true,
  morphologyKernelSize: 3,
  minForegroundRegionSize: 50,
  foregroundAlpha: 255,
  backgroundAlpha: 0,
};

// Preset configurations for common scenarios
export const BACKGROUND_REMOVAL_PRESETS = {
  balanced: DEFAULT_BACKGROUND_REMOVAL_CONFIG,

  dynamic: {
    ...DEFAULT_BACKGROUND_REMOVAL_CONFIG,
    useTemporalVariance: true,
    useEdgeDensity: false,
    useUniformity: false,
    varianceThreshold: 10.0,
  } as BackgroundRemovalConfig,

  subtle: {
    ...DEFAULT_BACKGROUND_REMOVAL_CONFIG,
    useTemporalVariance: false,
    useEdgeDensity: true,
    useUniformity: true,
    edgeDensityThreshold: 0.03,
    uniformityThreshold: 15.0,
  } as BackgroundRemovalConfig,

  aggressive: {
    ...DEFAULT_BACKGROUND_REMOVAL_CONFIG,
    useTemporalVariance: true,
    useEdgeDensity: true,
    useUniformity: true,
    varianceThreshold: 15.0,
    edgeDensityThreshold: 0.07,
    uniformityThreshold: 20.0,
  } as BackgroundRemovalConfig,

  gentle: {
    ...DEFAULT_BACKGROUND_REMOVAL_CONFIG,
    useTemporalVariance: true,
    useEdgeDensity: true,
    useUniformity: true,
    varianceThreshold: 30.0,
    edgeDensityThreshold: 0.03,
    uniformityThreshold: 10.0,
  } as BackgroundRemovalConfig,
};

export type PresetName = keyof typeof BACKGROUND_REMOVAL_PRESETS;
