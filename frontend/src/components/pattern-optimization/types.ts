export interface MaskedPattern {
  id: string;
  name: string;
  width: number;
  height: number;
  mask: Uint8Array; // Binary mask for confidence
  averagedPixels: Uint8Array; // RGBA averaged pixel values
  similarityThreshold: number; // Threshold used to create the mask
  confidenceMap: Float32Array; // Per-pixel confidence values (0-1)
  maskDensity: number; // Percentage of pixels above threshold
  activePixels: number;
  totalPixels: number;
  sourceStateImageId?: string;
  createdAt: string;
  updatedAt: string;

  // Performance metrics
  matchCount: number;
  successRate: number;
  avgMatchTime: number;

  // Pattern statistics
  minConfidence: number;
  maxConfidence: number;
  avgConfidence: number;
  stdDevConfidence: number;
}

export interface PatternExtractionConfig {
  similarityThreshold: number; // 0-1, pixels below this are masked out
  minActivePixels: number; // Minimum number of active pixels required
  colorAveraging: "mean" | "median" | "mode" | "weighted"; // How to average pixel values
  useAlphaChannel: boolean; // Whether to include alpha in averaging
  morphologicalOps: {
    enabled: boolean;
    erosionSize: number; // Remove small isolated pixels
    dilationSize: number; // Fill small gaps
  };
}

export interface PatternQualityAnalysis {
  quality: string;
  qualityColor: string;
  recommendations: string[];
}

export type DragHandle =
  | "tl"
  | "tr"
  | "bl"
  | "br"
  | "t"
  | "r"
  | "b"
  | "l"
  | "move"
  | null;

export interface Point {
  x: number;
  y: number;
}

export interface AdvancedRegionSelectorProps {
  screenshotId: string;
  screenshotUrl: string;
  region?: import("@/types/pattern-optimization").Region;
  onRegionChange: (
    region: import("@/types/pattern-optimization").Region
  ) => void;
  zoom?: number;
  panX?: number;
  panY?: number;
  onViewportChange?: (viewport: {
    zoom?: number;
    panX?: number;
    panY?: number;
  }) => void;
}
