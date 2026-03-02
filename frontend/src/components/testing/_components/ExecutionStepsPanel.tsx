"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Route } from "lucide-react";
import { UnifiedStepCard } from "@/components/shared/UnifiedStepCard";
import type { UnifiedExecutionStep } from "@/types/tree-events";

interface ExecutionStepsPanelProps {
  steps: UnifiedExecutionStep[];
  expandedStepIndex: number | null;
  onStepToggle: (index: number) => void;
  nameMap?: Map<string, string>;
}

export function ExecutionStepsPanel({
  steps,
  expandedStepIndex,
  onStepToggle,
  nameMap,
}: ExecutionStepsPanelProps) {
  if (steps.length === 0) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="py-12 text-center">
          <Route className="w-12 h-12 mx-auto mb-4 text-text-muted" />
          <h3 className="text-lg font-medium text-text-muted mb-2">
            No Execution Steps
          </h3>
          <p className="text-sm text-text-muted">
            This integration test has no recorded execution steps.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {steps.map((step, index) => (
        <UnifiedStepCard
          key={`step-${index}`}
          step={step}
          isExpanded={expandedStepIndex === index}
          onToggle={() => onStepToggle(index)}
          isCurrent={false}
          nameMap={nameMap}
        />
      ))}
    </div>
  );
}
