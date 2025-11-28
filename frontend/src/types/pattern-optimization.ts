/**
 * Pattern Optimization Types - Simplified
 * Single Responsibility: Define types for confidence-based pattern extraction
 */

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Screenshot {
  id: string;
  name: string;
  url: string; // Data URL or reference ID for IndexedDB
  region?: Region; // Selected region for pattern extraction
  uploadedAt: Date;
}

export interface ExtractionConfig {
  similarityThreshold: number; // 0-1, pixels below this are masked out
  colorAveraging: "mean" | "median" | "weighted"; // How to average pixel values
  morphologicalOps: {
    enabled: boolean;
    erosionSize: number; // Remove noise
    dilationSize: number; // Fill gaps
  };
  minActivePixels: number; // Minimum active pixels required
}

export interface ExtractedPattern {
  id: string;
  name: string;
  width: number;
  height: number;

  // Base64 encoded images
  patternImage: string; // The averaged pattern with mask applied
  confidenceMap: string; // Visualization of confidence values
  maskImage: string; // Binary mask visualization

  // Statistics
  maskDensity: number; // Percentage of pixels above threshold
  activePixels: number;
  totalPixels: number;
  minConfidence: number;
  maxConfidence: number;
  avgConfidence: number;
  stdDevConfidence: number;

  // Metadata
  config: ExtractionConfig;
  sourceScreenshotIds: string[]; // IDs of screenshots used
  createdAt: Date;

  // Optional fields for mask editing
  region?: Region; // Region where pattern was extracted from
  imageUrl?: string; // URL to the original image
  customMask?: string; // User-edited mask (base64 PNG)
}

export interface PatternSession {
  id: string;
  screenshots: Screenshot[];
  extractedPattern?: ExtractedPattern;
  status: "setup" | "extracting" | "complete" | "error";
  createdAt: Date;
  updatedAt: Date;
}

export interface PatternQuality {
  rating: "poor" | "fair" | "good" | "excellent";
  score: number; // 0-100
  recommendations: string[];
}

// New types for improved workflow
export type OptimizationScreenshot = Screenshot & {
  label?: "positive" | "negative" | "unlabeled";
};

export interface PatternAnalysis {
  extractedPatterns: ExtractedPattern[];
  statistics: {
    meanSimilarity: number;
    variance: number;
    minSimilarity: number;
    maxSimilarity: number;
    outliers: string[];
  };
  similarityMatrix: {
    scores: number[][];
  };
}

export interface OptimizationStrategy {
  type: "multi-pattern" | "consensus" | "feature-based" | "differential";
  parameters: Record<string, any>;
}

export interface StrategyEvaluation {
  strategy: OptimizationStrategy;
  performance: {
    truePositiveRate: number;
    falsePositiveRate: number;
    averageConfidence: number;
    processingTime: number;
  };
  recommendations: {
    confidenceLevel: "low" | "medium" | "high";
  };
}

export interface OptimizationSession {
  id: string;
  screenshots: OptimizationScreenshot[];
  analysis?: PatternAnalysis;
  evaluations: StrategyEvaluation[];
  selectedStrategy?: OptimizationStrategy;
  status: "setup" | "analyzing" | "complete" | "error";
  createdAt: Date;
  updatedAt: Date;
}

export interface OptimizationResult {
  patterns: ExtractedPattern[];
  strategy: OptimizationStrategy;
  sessionId: string;
  createdAt: Date;
}
