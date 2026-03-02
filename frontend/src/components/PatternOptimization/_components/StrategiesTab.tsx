"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Cpu,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  OptimizationStrategy,
  StrategyEvaluation,
  PatternAnalysis,
} from "@/types/pattern-optimization";

interface StrategiesTabProps {
  strategyTypes: OptimizationStrategy["type"][];
  evaluations: StrategyEvaluation[];
  selectedStrategy: OptimizationStrategy | null;
  selectStrategy: (strategy: OptimizationStrategy) => void;
  evaluating: string | null;
  handleEvaluateStrategy: (type: OptimizationStrategy["type"]) => void;
  analysis: PatternAnalysis;
}

const STRATEGY_DESCRIPTIONS: Record<OptimizationStrategy["type"], string> = {
  "multi-pattern": "Uses multiple pattern variations for robust matching",
  consensus: "Finds common elements across all examples",
  "feature-based": "Analyzes visual features like edges and colors",
  differential: "Identifies unique differences from negative examples",
};

export function StrategiesTab({
  strategyTypes,
  evaluations,
  selectedStrategy,
  selectStrategy,
  evaluating,
  handleEvaluateStrategy,
  analysis,
}: StrategiesTabProps) {
  return (
    <>
      {/* Metrics explanation */}
      <Card className="bg-surface-raised/30 border-border-default">
        <CardContent className="p-3">
          <div className="text-xs space-y-1">
            <div className="mb-3 p-2 bg-brand-primary/10 rounded">
              <p className="text-xs text-brand-primary">
                <span className="font-medium">Workflow:</span> 1) Analyze
                patterns → 2) Select a strategy → 3) Create StateImages
              </p>
              <p className="text-xs text-text-muted mt-1">
                The &quot;Select This Strategy&quot; button chooses which method
                to use. The &quot;Create StateImages&quot; button adds them to
                your project.
              </p>
            </div>
            <p className="font-medium text-text-secondary mb-2">
              Understanding Metrics:
            </p>
            <div className="grid grid-cols-2 gap-2 text-text-muted">
              <div>
                <span className="font-medium text-green-400">
                  TPR (True Positive Rate):
                </span>
                <p className="mt-1">
                  How often the strategy correctly identifies your pattern.
                  Higher is better (aim for 90%+)
                </p>
              </div>
              <div>
                <span className="font-medium text-red-400">
                  FPR (False Positive Rate):
                </span>
                <p className="mt-1">
                  How often it incorrectly matches. Lower is better (aim for
                  under 10%)
                </p>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-border-default">
              <p className="text-text-muted">
                <span className="font-medium">
                  Why medium confidence with 100% similarity?
                </span>{" "}
                Pattern similarity between your examples is perfect, but the
                strategy needs more diverse test cases to prove it won&apos;t
                match incorrect patterns in real-world use.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {strategyTypes.map((type) => {
        const evaluation = evaluations.find((e) => e.strategy.type === type);
        const isSelected = selectedStrategy?.type === type;
        const isEvaluating = evaluating === type;

        return (
          <Card
            key={type}
            className={cn(
              "bg-surface-raised/50 border-border-default cursor-pointer transition-all",
              isSelected && "border-brand-primary ring-1 ring-brand-primary/50"
            )}
            onClick={() => evaluation && selectStrategy(evaluation.strategy)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="text-sm font-medium capitalize">
                    {type.replace("-", " ")} Strategy
                  </h4>

                  {/* Strategy description */}
                  <p className="text-xs text-text-muted mt-1">
                    {STRATEGY_DESCRIPTIONS[type]}
                  </p>

                  {evaluation ? (
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center gap-4 text-xs">
                        <span
                          className="flex items-center gap-1"
                          title="True Positive Rate - Detection accuracy"
                        >
                          <CheckCircle className="w-3 h-3 text-green-500" />
                          <span className="text-text-secondary">
                            Accuracy:
                          </span>{" "}
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
                          <span className="text-text-secondary">
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
                          <Activity className="w-3 h-3 text-brand-primary" />
                          <span className="text-text-secondary">
                            Speed:
                          </span>{" "}
                          {evaluation.performance.processingTime.toFixed(0)}
                          ms
                        </span>
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-text-muted">
                            Confidence
                          </span>
                          <span className="text-xs text-text-muted">
                            {(
                              evaluation.performance.averageConfidence * 100
                            ).toFixed(0)}
                            %
                          </span>
                        </div>
                        <div className="h-1 bg-border-default rounded overflow-hidden">
                          <div
                            className="h-full bg-brand-primary transition-all"
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
                  <CheckCircle className="w-5 h-5 text-brand-primary" />
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}
