"use client";

import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  StateImageCreationDialog,
  StateImageConfig,
} from "./StateImageCreationDialog";
import { PatternEditor } from "./PatternEditor";
import { useAutomation } from "@/contexts/automation-context";
import {
  Play,
  RefreshCw,
  Download,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  BarChart3,
  Layers,
  Cpu,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { usePatternOptimization } from "@/contexts/pattern-optimization-context";
import type { OptimizationStrategy } from "@/types/pattern-optimization";
import type {
  StateImage,
  SearchRegion,
  Pattern,
} from "@/contexts/automation-context/types";

export function AnalysisPanel() {
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

  // Monitor state changes
  React.useEffect(() => {
    // State changes tracked
  }, [states]);

  const [evaluating, setEvaluating] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedPatterns, setSelectedPatterns] = useState<Set<string>>(
    new Set()
  );
  const [showStateImageDialog, setShowStateImageDialog] = useState(false);

  // Initialize selected patterns when analysis completes
  React.useEffect(() => {
    if (analysis?.extractedPatterns.length && selectedPatterns.size === 0) {
      setSelectedPatterns(new Set(analysis.extractedPatterns.map((p) => p.id)));
    }
  }, [analysis?.extractedPatterns]);

  const handleStartAnalysis = useCallback(async () => {
    try {
      await startAnalysis();
      toast.success("Analysis complete");
    } catch (_error) {
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
      } catch (_error) {
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

  // AnalysisPanel state tracked

  // Calculate strategy scores
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

  return (
    <div className="flex flex-col h-full space-y-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <h3 className="text-sm font-medium">Analysis & Results</h3>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleStartAnalysis}
            disabled={!canAnalyze || isAnalyzing}
            className="border-gray-700 hover:border-[#00D9FF]"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Play className="w-3 h-3 mr-1" />
                Analyze
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCreateStateImages}
            disabled={
              !selectedStrategy || !analysis || selectedPatterns.size === 0
            }
            className="border-gray-700 hover:border-[#BD00FF]"
            title={
              selectedPatterns.size === 0
                ? "Select patterns first"
                : "Create StateImages from selected patterns"
            }
          >
            <Download className="w-3 h-3 mr-1" />
            Create StateImages
          </Button>
        </div>
      </div>

      {!analysis ? (
        <Card className="flex-1 flex items-center justify-center bg-[#27272A]/50 border-gray-700">
          <div className="text-center">
            <BarChart3 className="w-12 h-12 mx-auto mb-2 text-gray-500" />
            <p className="text-sm text-gray-400">Run analysis to see results</p>
          </div>
        </Card>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="grid grid-cols-4 w-full bg-[#27272A] border-b border-gray-800 flex-shrink-0">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="patterns">Patterns</TabsTrigger>
            <TabsTrigger value="strategies">Strategies</TabsTrigger>
            <TabsTrigger value="similarity">Similarity</TabsTrigger>
          </TabsList>

          <TabsContent
            value="overview"
            className="flex-1 space-y-4 overflow-y-auto p-2"
          >
            {/* Statistics */}
            <Card className="bg-[#27272A]/50 border-gray-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Pattern Statistics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">
                    Patterns Extracted
                  </span>
                  <span className="text-sm font-bold">
                    {analysis.extractedPatterns.length}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Mean Similarity</span>
                  <span className="text-sm font-bold text-[#00D9FF]">
                    {(analysis.statistics.meanSimilarity * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Variance</span>
                  <span className="text-sm font-bold">
                    {(analysis.statistics.variance * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Range</span>
                  <span className="text-sm font-bold">
                    {(analysis.statistics.minSimilarity * 100).toFixed(1)}% -{" "}
                    {(analysis.statistics.maxSimilarity * 100).toFixed(1)}%
                  </span>
                </div>
                {analysis.statistics.outliers.length > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-400">Outliers</span>
                    <Badge variant="destructive" className="text-xs">
                      {analysis.statistics.outliers.length}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recommendations */}
            {bestStrategy && (
              <Card className="bg-[#27272A]/50 border-gray-700">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-green-500" />
                    Recommended Strategy
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {bestStrategy.strategy.type}
                      </span>
                      <Badge
                        variant={
                          bestStrategy.recommendations.confidenceLevel ===
                          "high"
                            ? "default"
                            : "secondary"
                        }
                        className={cn(
                          bestStrategy.recommendations.confidenceLevel ===
                            "high" && "bg-green-500"
                        )}
                      >
                        {bestStrategy.recommendations.confidenceLevel}{" "}
                        confidence
                      </Badge>
                    </div>
                    <div className="text-xs text-gray-400">
                      <span title="True Positive Rate - How often it correctly finds the pattern">
                        TPR:{" "}
                        {(
                          bestStrategy.performance.truePositiveRate * 100
                        ).toFixed(1)}
                        %
                      </span>
                      {" • "}
                      <span title="False Positive Rate - How often it incorrectly matches">
                        FPR:{" "}
                        {(
                          bestStrategy.performance.falsePositiveRate * 100
                        ).toFixed(1)}
                        %
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {bestStrategy.recommendations.confidenceLevel ===
                        "medium" && (
                        <span>
                          Medium confidence: May need more diverse examples for
                          better accuracy
                        </span>
                      )}
                      {bestStrategy.recommendations.confidenceLevel ===
                        "low" && (
                        <span>
                          Low confidence: Limited test data or high variability
                          detected
                        </span>
                      )}
                      {bestStrategy.recommendations.confidenceLevel ===
                        "high" && (
                        <span>
                          High confidence: Strong pattern consistency across
                          examples
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => selectStrategy(bestStrategy.strategy)}
                      className="w-full border-gray-700 hover:border-green-500 text-xs"
                      title="Select this strategy for creating StateImages"
                    >
                      Select This Strategy
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent
            value="patterns"
            className="flex-1 space-y-2 overflow-y-auto p-2"
          >
            <Card className="bg-[#27272A]/50 border-gray-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Extracted Patterns</span>
                  <span className="text-xs text-gray-400">
                    {selectedPatterns.size} /{" "}
                    {analysis.extractedPatterns.length} selected
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {analysis.extractedPatterns.length === 0 ? (
                  <div className="text-center py-4 text-gray-400 text-sm">
                    No patterns extracted yet
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2 mb-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setSelectedPatterns(
                            new Set(analysis.extractedPatterns.map((p) => p.id))
                          )
                        }
                        className="text-xs border-gray-700 hover:border-[#00D9FF]"
                      >
                        Select All
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedPatterns(new Set())}
                        className="text-xs border-gray-700 hover:border-red-500"
                      >
                        Clear Selection
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {analysis.extractedPatterns.map((pattern, idx) => {
                        const isSelected = selectedPatterns.has(pattern.id);
                        return (
                          <div
                            key={pattern.id}
                            className={cn(
                              "border rounded-lg p-2 transition-all",
                              isSelected
                                ? "border-[#00D9FF] bg-[#00D9FF]/10"
                                : "border-gray-700"
                            )}
                          >
                            <div
                              className="cursor-pointer"
                              onClick={() => {
                                const newSelection = new Set(selectedPatterns);
                                if (isSelected) {
                                  newSelection.delete(pattern.id);
                                } else {
                                  newSelection.add(pattern.id);
                                }
                                setSelectedPatterns(newSelection);
                              }}
                            >
                              <div className="aspect-video bg-gray-800 rounded mb-2 flex items-center justify-center overflow-hidden">
                                {pattern.imageUrl ? (
                                  <img
                                    src={
                                      pattern.customMask
                                        ? pattern.customMask
                                        : pattern.imageUrl
                                    }
                                    alt={`Pattern ${idx + 1}`}
                                    className="w-full h-full object-contain"
                                  />
                                ) : (
                                  <Layers className="w-8 h-8 text-gray-600" />
                                )}
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium">
                                  Pattern {idx + 1}
                                </span>
                                {isSelected && (
                                  <CheckCircle className="w-4 h-4 text-[#00D9FF]" />
                                )}
                              </div>
                            </div>
                            <div className="mt-2 pt-2 border-t border-gray-700">
                              <PatternEditor
                                pattern={pattern}
                                onUpdatePattern={updatePattern}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 pt-4 border-t border-gray-700">
                      <p className="text-xs text-gray-400 mb-2">
                        Select the patterns you want to include in the
                        StateImage. At least one pattern must be selected.
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="strategies"
            className="flex-1 space-y-2 overflow-y-auto p-2"
          >
            {/* Metrics explanation */}
            <Card className="bg-[#27272A]/30 border-gray-700">
              <CardContent className="p-3">
                <div className="text-xs space-y-1">
                  <div className="mb-3 p-2 bg-[#00D9FF]/10 rounded">
                    <p className="text-xs text-[#00D9FF]">
                      <span className="font-medium">Workflow:</span> 1) Analyze
                      patterns → 2) Select a strategy → 3) Create StateImages
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      The &quot;Select This Strategy&quot; button chooses which method to
                      use. The &quot;Create StateImages&quot; button adds them to your
                      project.
                    </p>
                  </div>
                  <p className="font-medium text-gray-300 mb-2">
                    Understanding Metrics:
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-gray-400">
                    <div>
                      <span className="font-medium text-green-400">
                        TPR (True Positive Rate):
                      </span>
                      <p className="mt-1">
                        How often the strategy correctly identifies your
                        pattern. Higher is better (aim for 90%+)
                      </p>
                    </div>
                    <div>
                      <span className="font-medium text-red-400">
                        FPR (False Positive Rate):
                      </span>
                      <p className="mt-1">
                        How often it incorrectly matches. Lower is better (aim
                        for under 10%)
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-700">
                    <p className="text-gray-500">
                      <span className="font-medium">
                        Why medium confidence with 100% similarity?
                      </span>{" "}
                      Pattern similarity between your examples is perfect, but
                      the strategy needs more diverse test cases to prove it
                      won&apos;t match incorrect patterns in real-world use.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {strategyTypes.map((type) => {
              const evaluation = evaluations.find(
                (e) => e.strategy.type === type
              );
              const isSelected = selectedStrategy?.type === type;
              const isEvaluating = evaluating === type;

              return (
                <Card
                  key={type}
                  className={cn(
                    "bg-[#27272A]/50 border-gray-700 cursor-pointer transition-all",
                    isSelected && "border-[#00D9FF] ring-1 ring-[#00D9FF]/50"
                  )}
                  onClick={() =>
                    evaluation && selectStrategy(evaluation.strategy)
                  }
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="text-sm font-medium capitalize">
                          {type.replace("-", " ")} Strategy
                        </h4>

                        {/* Strategy description */}
                        <p className="text-xs text-gray-500 mt-1">
                          {type === "multi-pattern" &&
                            "Uses multiple pattern variations for robust matching"}
                          {type === "consensus" &&
                            "Finds common elements across all examples"}
                          {type === "feature-based" &&
                            "Analyzes visual features like edges and colors"}
                          {type === "differential" &&
                            "Identifies unique differences from negative examples"}
                        </p>

                        {evaluation ? (
                          <div className="mt-2 space-y-2">
                            <div className="flex items-center gap-4 text-xs">
                              <span
                                className="flex items-center gap-1"
                                title="True Positive Rate - Detection accuracy"
                              >
                                <CheckCircle className="w-3 h-3 text-green-500" />
                                <span className="text-gray-300">Accuracy:</span>{" "}
                                {(
                                  evaluation.performance.truePositiveRate * 100
                                ).toFixed(1)}
                                %
                              </span>
                              <span
                                className="flex items-center gap-1"
                                title="False Positive Rate - Mistake rate"
                              >
                                <AlertCircle className="w-3 h-3 text-red-500" />
                                <span className="text-gray-300">
                                  Errors:
                                </span>{" "}
                                {(
                                  evaluation.performance.falsePositiveRate * 100
                                ).toFixed(1)}
                                %
                              </span>
                              <span
                                className="flex items-center gap-1"
                                title="Processing time per match"
                              >
                                <Activity className="w-3 h-3 text-[#00D9FF]" />
                                <span className="text-gray-300">
                                  Speed:
                                </span>{" "}
                                {evaluation.performance.processingTime.toFixed(
                                  0
                                )}
                                ms
                              </span>
                            </div>
                            <div>
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-xs text-gray-500">
                                  Confidence
                                </span>
                                <span className="text-xs text-gray-400">
                                  {(
                                    evaluation.performance.averageConfidence *
                                    100
                                  ).toFixed(0)}
                                  %
                                </span>
                              </div>
                              <div className="h-1 bg-gray-700 rounded overflow-hidden">
                                <div
                                  className="h-full bg-[#00D9FF] transition-all"
                                  style={{
                                    width: `${evaluation.performance.averageConfidence * 100}%`,
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEvaluateStrategy(type);
                            }}
                            disabled={isEvaluating || !analysis}
                            className="mt-2 h-6 px-2 text-xs"
                          >
                            {isEvaluating ? (
                              <>
                                <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                                Evaluating...
                              </>
                            ) : (
                              <>
                                <Cpu className="w-3 h-3 mr-1" />
                                Evaluate
                              </>
                            )}
                          </Button>
                        )}
                      </div>

                      {isSelected && (
                        <CheckCircle className="w-5 h-5 text-[#00D9FF]" />
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent
            value="similarity"
            className="flex-1 overflow-y-auto p-2"
          >
            <Card className="bg-[#27272A]/50 border-gray-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Similarity Matrix</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className="p-1 text-left text-gray-400">Pattern</th>
                        {analysis.extractedPatterns.map((_, i) => (
                          <th key={i} className="p-1 text-center text-gray-400">
                            P{i + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.similarityMatrix.scores.map((row, i) => (
                        <tr key={i}>
                          <td className="p-1 text-gray-400">P{i + 1}</td>
                          {row.map((score, j) => (
                            <td
                              key={j}
                              className={cn(
                                "p-1 text-center",
                                i === j && "bg-gray-800",
                                score >= 0.9 && i !== j && "text-green-500",
                                score < 0.7 && i !== j && "text-red-500"
                              )}
                            >
                              {(score * 100).toFixed(0)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-center justify-center gap-4 text-xs">
                  <span className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-green-500 rounded" />
                    High (≥90%)
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-yellow-500 rounded" />
                    Medium (70-89%)
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-red-500 rounded" />
                    Low (&lt;70%)
                  </span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* StateImage Creation Dialog */}
      {showStateImageDialog && analysis && selectedStrategy && (
        <StateImageCreationDialog
          isOpen={showStateImageDialog}
          onClose={() => setShowStateImageDialog(false)}
          patterns={analysis.extractedPatterns.filter((p) =>
            selectedPatterns.has(p.id)
          )}
          strategy={selectedStrategy}
          onCreateStateImage={handleStateImageCreation}
        />
      )}
    </div>
  );
}
