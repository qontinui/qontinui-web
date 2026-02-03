"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle,
  Circle,
  Play,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ReproductionPathViewerProps {
  steps: string[];
  className?: string;
}

/**
 * ReproductionPathViewer - Visualize reproduction steps
 *
 * Features:
 * - Step-by-step visualization
 * - Numbered steps with connecting lines
 * - Expandable/collapsible steps
 * - Mark steps as completed (for verification)
 * - Copy all steps to clipboard
 * - Visual progress indicator
 * - Responsive design
 */
export function ReproductionPathViewer({
  steps,
  className,
}: ReproductionPathViewerProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(
    new Set(steps.map((_, i) => i))
  );
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const toggleStep = (index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const toggleComplete = (index: number) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSteps(new Set(steps.map((_, i) => i)));
  };

  const collapseAll = () => {
    setCompletedSteps(new Set());
  };

  const copyAllSteps = () => {
    const text = steps.map((step, i) => `${i + 1}. ${step}`).join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Steps copied to clipboard");
  };

  const completionPercentage = Math.round(
    (completedSteps.size / steps.length) * 100
  );

  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Play className="h-12 w-12 mb-2 opacity-20" />
        <p className="text-sm">No reproduction steps available</p>
      </div>
    );
  }

  return (
    <div
      className={cn("space-y-4", className)}
      data-ui-id="testing-reproduction-path-viewer"
    >
      {/* Header Controls */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {steps.length} {steps.length === 1 ? "Step" : "Steps"}
          </Badge>
          {completedSteps.size > 0 && (
            <Badge variant="outline">{completionPercentage}% Verified</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={expandAll}
            data-ui-id="testing-reproduction-path-expand-btn"
          >
            Expand All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={collapseAll}
            data-ui-id="testing-reproduction-path-reset-btn"
          >
            Reset Progress
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={copyAllSteps}
            data-ui-id="testing-reproduction-path-copy-btn"
          >
            <Copy className="h-4 w-4 mr-2" />
            Copy
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      {completedSteps.size > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Verification Progress</span>
            <span>{completionPercentage}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${completionPercentage}%` }}
            />
          </div>
        </div>
      )}

      <Separator />

      {/* Steps List */}
      <div
        className="space-y-2"
        data-ui-id="testing-reproduction-path-steps-list"
      >
        {steps.map((step, index) => {
          const isExpanded = expandedSteps.has(index);
          const isCompleted = completedSteps.has(index);
          const isLast = index === steps.length - 1;

          return (
            <div key={index} className="relative">
              <Card
                className={cn(
                  "transition-all duration-200",
                  isCompleted &&
                    "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900"
                )}
              >
                <CardContent className="p-0">
                  {/* Step Header */}
                  <div
                    className="flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => toggleStep(index)}
                  >
                    {/* Step Number / Checkbox */}
                    <button
                      className="flex-shrink-0 mt-0.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleComplete(index);
                      }}
                    >
                      {isCompleted ? (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-primary flex items-center justify-center text-xs font-medium">
                          {index + 1}
                        </div>
                      )}
                    </button>

                    {/* Step Content */}
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          isCompleted && "line-through text-muted-foreground"
                        )}
                      >
                        {step}
                      </p>
                    </div>

                    {/* Expand/Collapse Icon */}
                    <button className="flex-shrink-0">
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      )}
                    </button>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3">
                      <Separator />
                      <div className="text-xs text-muted-foreground">
                        <p className="font-medium mb-2">
                          Step {index + 1} Details:
                        </p>
                        <p className="whitespace-pre-wrap">{step}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleComplete(index);
                          }}
                        >
                          {isCompleted ? (
                            <>
                              <Circle className="h-3 w-3 mr-2" />
                              Mark Incomplete
                            </>
                          ) : (
                            <>
                              <CheckCircle className="h-3 w-3 mr-2" />
                              Mark Complete
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(step);
                            toast.success("Step copied to clipboard");
                          }}
                        >
                          <Copy className="h-3 w-3 mr-2" />
                          Copy
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Connector Line */}
              {!isLast && (
                <div className="flex items-center justify-center my-1">
                  <div
                    className={cn(
                      "w-0.5 h-4 transition-colors",
                      isCompleted && completedSteps.has(index + 1)
                        ? "bg-green-500"
                        : "bg-border"
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Info */}
      <Separator />
      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          <strong>Tip:</strong> Click the checkmark to mark steps as verified
          during reproduction testing
        </p>
        <p>
          <strong>Navigation:</strong> Click step headers to expand/collapse
          details
        </p>
      </div>
    </div>
  );
}
