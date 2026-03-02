import type { ReactNode } from "react";
import type {
  OptimizationScreenshot,
  Region,
  PatternAnalysis,
  OptimizationStrategy,
  StrategyEvaluation,
  OptimizationSession,
  OptimizationResult,
} from "@/types/pattern-optimization";

export interface PatternOptimizationFullContextType {
  // Session management
  session: OptimizationSession | null;
  createSession: () => void;
  clearSession: () => void;

  // Screenshot management
  addScreenshots: (screenshots: OptimizationScreenshot[]) => void;
  removeScreenshot: (id: string) => void;
  labelScreenshot: (
    id: string,
    label: "positive" | "negative" | "unlabeled"
  ) => void;

  // Region management
  setRegion: (screenshotId: string, region: Region | null) => void;
  copyRegionToAll: (sourceId: string) => void;
  clearRegions: () => void;

  // Analysis
  startAnalysis: () => Promise<void>;
  analysis: PatternAnalysis | null;
  isAnalyzing: boolean;

  // Pattern editing
  updatePattern: (patternId: string, customMask: string) => void;

  // Strategy evaluation
  evaluateStrategy: (
    strategy: OptimizationStrategy
  ) => Promise<StrategyEvaluation>;
  evaluations: StrategyEvaluation[];
  selectedStrategy: OptimizationStrategy | null;
  selectStrategy: (strategy: OptimizationStrategy) => void;

  // Results
  generateResult: (
    selectedPatternIds?: Set<string>
  ) => Promise<OptimizationResult | null>;
  exportResult: (result: OptimizationResult) => void;
}

export interface PatternOptimizationFullProviderProps {
  children: ReactNode;
}
