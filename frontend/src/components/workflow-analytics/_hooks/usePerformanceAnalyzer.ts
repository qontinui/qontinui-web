"use client";

import { useState, useMemo, useCallback } from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  PerformanceData,
  OptimizationSuggestion,
  HeatmapDataPoint,
} from "../performance-analyzer-types";
import { generateMockPerformanceData } from "../performance-analyzer-utils";

export function usePerformanceAnalyzer(
  workflow: Workflow,
  propPerformanceData: PerformanceData | undefined,
  onAnalyze: () => void,
  onApplySuggestion: (suggestion: OptimizationSuggestion) => void
) {
  const [analyzing, setAnalyzing] = useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(
    new Set()
  );

  const performanceData = useMemo(() => {
    return propPerformanceData || generateMockPerformanceData(workflow);
  }, [propPerformanceData, workflow]);

  const activeSuggestions = useMemo(() => {
    return performanceData.suggestions.filter(
      (s) => !dismissedSuggestions.has(s.id)
    );
  }, [performanceData.suggestions, dismissedSuggestions]);

  const totalPotentialSavings = useMemo(() => {
    return activeSuggestions.reduce(
      (sum, s) => sum + s.estimatedImprovement,
      0
    );
  }, [activeSuggestions]);

  const heatmapData: HeatmapDataPoint[] = useMemo(() => {
    return performanceData.actionTimings.map((t) => ({
      name: t.actionName.substring(0, 15),
      duration: t.duration,
      fill:
        t.duration > performanceData.totalDuration * 0.2
          ? "#ef4444"
          : t.duration > performanceData.totalDuration * 0.1
            ? "#f59e0b"
            : "#10b981",
    }));
  }, [performanceData]);

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      onAnalyze();
    } finally {
      setAnalyzing(false);
    }
  }, [onAnalyze]);

  const handleApplySuggestion = useCallback(
    (suggestion: OptimizationSuggestion) => {
      onApplySuggestion(suggestion);
    },
    [onApplySuggestion]
  );

  const handleDismissSuggestion = useCallback((suggestionId: string) => {
    setDismissedSuggestions((prev) => new Set([...prev, suggestionId]));
  }, []);

  return {
    analyzing,
    performanceData,
    activeSuggestions,
    totalPotentialSavings,
    heatmapData,
    handleAnalyze,
    handleApplySuggestion,
    handleDismissSuggestion,
  };
}
