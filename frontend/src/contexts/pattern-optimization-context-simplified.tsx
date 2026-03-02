"use client";

import React, { createContext, useContext, useCallback, useMemo } from "react";
import type {
  PatternOptimizationContextType,
  PatternOptimizationProviderProps,
} from "./pattern-optimization/types";
import { usePatternSession } from "./pattern-optimization/use-pattern-session";
import { usePatternExtraction } from "./pattern-optimization/use-pattern-extraction";
import { analyzePatternQuality } from "./pattern-optimization/pattern-quality";
import { exportPattern as exportPatternUtil } from "./pattern-optimization/pattern-export";

const PatternOptimizationContext = createContext<
  PatternOptimizationContextType | undefined
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
}: PatternOptimizationProviderProps) {
  const {
    session,
    setSession,
    createSession,
    clearSession,
    addScreenshots,
    removeScreenshot,
    setScreenshotRegion,
    setAllScreenshotRegions,
    copyRegionToAll,
    clearAllRegions,
  } = usePatternSession();

  const { isExtracting, extractPattern } = usePatternExtraction(
    session,
    setSession
  );

  const exportPattern = useCallback(
    (pattern: Parameters<typeof exportPatternUtil>[0]) => {
      exportPatternUtil(pattern, session?.id);
    },
    [session]
  );

  const contextValue: PatternOptimizationContextType = useMemo(
    () => ({
      session,
      createSession,
      clearSession,
      addScreenshots,
      removeScreenshot,
      setScreenshotRegion,
      setAllScreenshotRegions,
      copyRegionToAll,
      clearAllRegions,
      extractPattern,
      isExtracting,
      extractedPattern: session?.extractedPattern || null,
      analyzePatternQuality,
      exportPattern,
    }),
    [
      session,
      createSession,
      clearSession,
      addScreenshots,
      removeScreenshot,
      setScreenshotRegion,
      setAllScreenshotRegions,
      copyRegionToAll,
      clearAllRegions,
      extractPattern,
      isExtracting,
      exportPattern,
    ]
  );

  return (
    <PatternOptimizationContext.Provider value={contextValue}>
      {children}
    </PatternOptimizationContext.Provider>
  );
}
