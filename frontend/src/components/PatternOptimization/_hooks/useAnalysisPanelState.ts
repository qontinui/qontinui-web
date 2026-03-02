"use client";

import { useState, useCallback } from "react";
import React from "react";
import { toast } from "sonner";
import { usePatternOptimization } from "@/contexts/pattern-optimization-context";
import { useAutomation } from "@/contexts/automation-context";
import type { OptimizationStrategy } from "@/types/pattern-optimization";
import type {
  StateImage,
  SearchRegion,
  Pattern,
} from "@/contexts/automation-context/types";
import type { StateImageConfig } from "../StateImageCreationDialog";

export function useAnalysisPanelState() {
  const {
    session,
    analysis,
    isAnalyzing,
    startAnalysis,
    updatePattern,
    evaluateStrategy,
    evaluations,
    selectedStrategy,
    selectStrategy,
  } = usePatternOptimization();

  const { states, addState, updateState } = useAutomation();

  const [evaluating, setEvaluating] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedPatterns, setSelectedPatterns] = useState<Set<string>>(
    new Set()
  );
  const [showStateImageDialog, setShowStateImageDialog] = useState(false);

  // Monitor state changes
  React.useEffect(() => {
    // State changes tracked
  }, [states]);

  // Initialize selected patterns when analysis completes
  React.useEffect(() => {
    if (analysis?.extractedPatterns.length && selectedPatterns.size === 0) {
      setSelectedPatterns(new Set(analysis.extractedPatterns.map((p) => p.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally excluding selectedPatterns.size to avoid infinite loop; effect only runs on new analysis
  }, [analysis?.extractedPatterns]);

  const handleStartAnalysis = useCallback(async () => {
    try {
      await startAnalysis();
      toast.success("Analysis complete");
    } catch (error) {
      console.error("Analysis error in handleStartAnalysis:", error);
      toast.error("Analysis failed");
    }
  }, [startAnalysis]);

  const handleEvaluateStrategy = useCallback(
    async (type: OptimizationStrategy["type"]) => {
      setEvaluating(type);
      try {
        const strategy: OptimizationStrategy = {
          type,
          parameters: {},
        };
        await evaluateStrategy(strategy);
        toast.success(`${type} strategy evaluated`);
      } catch (_error) {
        toast.error("Evaluation failed");
      } finally {
        setEvaluating(null);
      }
    },
    [evaluateStrategy]
  );

  const handleCreateStateImages = useCallback(() => {
    if (!selectedStrategy) {
      toast.error("No strategy selected", {
        description: "Please select an optimization strategy first",
      });
      return;
    }

    if (selectedPatterns.size === 0) {
      toast.error("No patterns selected", {
        description: "Please select at least one pattern to create StateImages",
      });
      return;
    }

    if (!analysis) {
      toast.error("No analysis available");
      return;
    }

    setShowStateImageDialog(true);
  }, [selectedStrategy, selectedPatterns, analysis]);

  const handleStateImageCreation = useCallback(
    async (config: StateImageConfig) => {
      // Creating StateImages with config
      if (!analysis || !selectedStrategy) return;

      try {
        // Get selected patterns
        const patternsToUse = analysis.extractedPatterns.filter((p) =>
          selectedPatterns.has(p.id)
        );
        // Using selected patterns

        // Create or get the target state
        let targetStateId = config.stateId;
        if (config.createNewState) {
          const newState = {
            id: `state-${Date.now()}`,
            name: config.stateName,
            description: "Created from pattern optimization",
            stateImages: [],
            regions: [],
            locations: [],
            strings: [],
            position: { x: 100, y: 100 },
          };
          addState(newState);
          targetStateId = newState.id;
          // Created new state
        }

        // Create StateImages from patterns
        const stateImages: StateImage[] = patternsToUse.map((pattern, idx) => {
          const searchRegions: SearchRegion[] =
            config.includeSearchRegions && pattern.region
              ? [
                  {
                    id: `search-${pattern.id}`,
                    name: config.searchRegionName || "Pattern Search Region",
                    x: pattern.region.x,
                    y: pattern.region.y,
                    width: pattern.region.width,
                    height: pattern.region.height,
                  },
                ]
              : [];

          // Create a Pattern object for this StateImage
          const imageName = config.imageNames[idx] ?? `Pattern ${idx + 1}`;
          const patternObj: Pattern = {
            id: `pattern-${Date.now()}-${idx}`,
            name: imageName,
            imageId: undefined, // Will be set when image is uploaded to library
            searchRegions,
            fixed: false,
          };

          return {
            id: `stateimage-${Date.now()}-${idx}`,
            name: imageName,
            patterns: [patternObj],
            shared: false,
            source: "pattern-optimization" as const,
            searchRegions,
          };
        });

        // Created StateImages

        // Update the state with new StateImages
        if (targetStateId) {
          const targetState = states.find((s) => s.id === targetStateId);
          // Found target state

          if (targetState) {
            const updatedState = {
              ...targetState,
              stateImages: [...(targetState.stateImages || []), ...stateImages],
            };
            // Updating state with new StateImages
            updateState(updatedState);

            // Note: State updates are async, changes will appear after re-render

            toast.success("StateImages created successfully", {
              description: `Added ${stateImages.length} StateImage${stateImages.length > 1 ? "s" : ""} to ${config.stateName}`,
            });
          } else {
            console.error("Target state not found!");
          }
        } else {
          console.error("No target state ID!");
        }

        setShowStateImageDialog(false);
      } catch (error) {
        console.error("Failed to create StateImages:", error);
        toast.error("Failed to create StateImages", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
    [
      analysis,
      selectedStrategy,
      selectedPatterns,
      states,
      addState,
      updateState,
    ]
  );

  const canAnalyze = session?.screenshots.some(
    (s) => s.label === "positive" && s.region
  );

  const strategyTypes: OptimizationStrategy["type"][] = [
    "multi-pattern",
    "consensus",
    "feature-based",
    "differential",
  ];

  const bestStrategy = evaluations.reduce((best, current) => {
    if (!best) return current;
    const currentScore =
      current.performance.truePositiveRate -
      current.performance.falsePositiveRate;
    const bestScore =
      best.performance.truePositiveRate - best.performance.falsePositiveRate;
    return currentScore > bestScore ? current : best;
  }, evaluations[0]);

  return {
    analysis,
    isAnalyzing,
    updatePattern,
    evaluations,
    selectedStrategy,
    selectStrategy,
    evaluating,
    activeTab,
    setActiveTab,
    selectedPatterns,
    setSelectedPatterns,
    showStateImageDialog,
    setShowStateImageDialog,
    handleStartAnalysis,
    handleEvaluateStrategy,
    handleCreateStateImages,
    handleStateImageCreation,
    canAnalyze,
    strategyTypes,
    bestStrategy,
  };
}
