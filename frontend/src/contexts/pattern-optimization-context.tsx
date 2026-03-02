"use client";

import React, { createContext, useContext, useCallback } from "react";
import type {
  PatternOptimizationFullContextType,
  PatternOptimizationFullProviderProps,
} from "./pattern-optimization/types-full";
import { useOptimizationSession } from "./pattern-optimization/use-optimization-session";
import { useOptimizationAnalysis } from "./pattern-optimization/use-optimization-analysis";
import {
  generateOptimizationResult,
  exportOptimizationResult,
} from "./pattern-optimization/optimization-result";
import type { OptimizationResult } from "@/types/pattern-optimization";

const PatternOptimizationContext = createContext<
  PatternOptimizationFullContextType | undefined
>(undefined);

export const usePatternOptimization = () => {
  const context = useContext(PatternOptimizationContext);
  if (!context) {
    throw new Error(
      "usePatternOptimization must be used within a PatternOptimizationProvider"
    );
  }
  return context;
};

export function PatternOptimizationProvider({
  children,
}: PatternOptimizationFullProviderProps) {
  const {
    session,
    setSession,
    createSession,
    clearSession,
    addScreenshots,
    removeScreenshot,
    labelScreenshot,
    setRegion,
    copyRegionToAll,
    clearRegions,
    updatePattern,
  } = useOptimizationSession();

  const { isAnalyzing, startAnalysis, evaluateStrategy, selectStrategy } =
    useOptimizationAnalysis(session, setSession);

  const generateResult = useCallback(
    async (
      selectedPatternIds?: Set<string>
    ): Promise<OptimizationResult | null> => {
      if (!session?.selectedStrategy || !session.analysis) {
        return null;
      }
      try {
        return await generateOptimizationResult(session, selectedPatternIds);
      } catch (error) {
        console.error("Failed to generate result:", error);
        throw error;
      }
    },
    [session]
  );

  const exportResult = useCallback((result: OptimizationResult) => {
    exportOptimizationResult(result);
  }, []);

  const contextValue: PatternOptimizationFullContextType = {
    session,
    createSession,
    clearSession,
    addScreenshots,
    removeScreenshot,
    labelScreenshot,
    setRegion,
    copyRegionToAll,
    clearRegions,
    startAnalysis,
    analysis: session?.analysis || null,
    isAnalyzing,
    updatePattern,
    evaluateStrategy,
    evaluations: session?.evaluations || [],
    selectedStrategy: session?.selectedStrategy || null,
    selectStrategy,
    generateResult,
    exportResult,
  };

  return (
    <PatternOptimizationContext.Provider value={contextValue}>
      {children}
    </PatternOptimizationContext.Provider>
  );
}
