"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  PatternAnalysis,
  StrategyEvaluation,
  OptimizationStrategy,
} from "@/types/pattern-optimization";

interface OverviewTabProps {
  analysis: PatternAnalysis;
  bestStrategy: StrategyEvaluation | undefined;
  selectStrategy: (strategy: OptimizationStrategy) => void;
}

export function OverviewTab({
  analysis,
  bestStrategy,
  selectStrategy,
}: OverviewTabProps) {
  return (
    <>
      {/* Statistics */}
      <Card className="bg-surface-raised/50 border-border-default">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Pattern Statistics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs text-text-muted">Patterns Extracted</span>
            <span className="text-sm font-bold">
              {analysis.extractedPatterns.length}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-text-muted">Mean Similarity</span>
            <span className="text-sm font-bold text-brand-primary">
              {(analysis.statistics.meanSimilarity * 100).toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-text-muted">Variance</span>
            <span className="text-sm font-bold">
              {(analysis.statistics.variance * 100).toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-text-muted">Range</span>
            <span className="text-sm font-bold">
              {(analysis.statistics.minSimilarity * 100).toFixed(1)}% -{" "}
              {(analysis.statistics.maxSimilarity * 100).toFixed(1)}%
            </span>
          </div>
          {analysis.statistics.outliers.length > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-text-muted">Outliers</span>
              <Badge variant="destructive" className="text-xs">
                {analysis.statistics.outliers.length}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recommendations */}
      {bestStrategy && (
        <Card className="bg-surface-raised/50 border-border-default">
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
                    bestStrategy.recommendations.confidenceLevel === "high"
                      ? "default"
                      : "secondary"
                  }
                  className={cn(
                    bestStrategy.recommendations.confidenceLevel === "high" &&
                      "bg-green-500"
                  )}
                >
                  {bestStrategy.recommendations.confidenceLevel} confidence
                </Badge>
              </div>
              <div className="text-xs text-text-muted">
                <span title="True Positive Rate - How often it correctly finds the pattern">
                  TPR:{" "}
                  {(bestStrategy.performance.truePositiveRate * 100).toFixed(1)}
                  %
                </span>
                {" • "}
                <span title="False Positive Rate - How often it incorrectly matches">
                  FPR:{" "}
                  {(bestStrategy.performance.falsePositiveRate * 100).toFixed(
                    1
                  )}
                  %
                </span>
              </div>
              <div className="text-xs text-text-muted mt-1">
                {bestStrategy.recommendations.confidenceLevel === "medium" && (
                  <span>
                    Medium confidence: May need more diverse examples for better
                    accuracy
                  </span>
                )}
                {bestStrategy.recommendations.confidenceLevel === "low" && (
                  <span>
                    Low confidence: Limited test data or high variability
                    detected
                  </span>
                )}
                {bestStrategy.recommendations.confidenceLevel === "high" && (
                  <span>
                    High confidence: Strong pattern consistency across examples
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => selectStrategy(bestStrategy.strategy)}
                className="w-full border-border-default hover:border-green-500 text-xs"
                title="Select this strategy for creating StateImages"
              >
                Select This Strategy
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
