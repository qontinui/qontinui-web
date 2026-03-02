import type { ReactNode } from "react";
import type {
  Region,
  ExtractedPattern,
  ExtractionConfig,
  PatternSession,
  PatternQuality,
} from "@/types/pattern-optimization";

export interface PatternOptimizationContextType {
  // Session management
  session: PatternSession | null;
  createSession: () => void;
  clearSession: () => void;

  // Screenshot management
  addScreenshots: (files: File[]) => Promise<void>;
  removeScreenshot: (id: string) => void;
  setScreenshotRegion: (id: string, region: Region) => void;
  setAllScreenshotRegions: (region: Region) => void;
  copyRegionToAll: (sourceId: string) => void;
  clearAllRegions: () => void;

  // Pattern extraction
  extractPattern: (config: ExtractionConfig) => Promise<void>;
  isExtracting: boolean;
  extractedPattern: ExtractedPattern | null;

  // Pattern quality
  analyzePatternQuality: (pattern: ExtractedPattern) => PatternQuality;

  // Export
  exportPattern: (pattern: ExtractedPattern) => void;
}

export interface PatternOptimizationProviderProps {
  children: ReactNode;
}
