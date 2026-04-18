"use client";

import { Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { UnifiedWorkflow } from "@/types/unified-workflow";

export function WorkflowListItem({
  workflow,
  isSelected,
  onClick,
}: {
  workflow: UnifiedWorkflow;
  isSelected: boolean;
  onClick: () => void;
}) {
  const stepCount =
    (workflow.setupSteps?.length ?? 0) +
    (workflow.verificationSteps?.length ?? 0) +
    (workflow.agenticSteps?.length ?? 0) +
    (workflow.completionSteps?.length ?? 0);

  return (
    <div
      className={`p-3 rounded-lg border cursor-pointer transition-all ${
        isSelected
          ? "bg-brand-primary/10 border-brand-primary/40"
          : "bg-surface-canvas/50 border-border-subtle/30 hover:border-border-default"
      }`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Workflow className="size-4 text-text-muted shrink-0" />
        <span className="text-sm font-medium text-text-primary truncate">
          {workflow.name}
        </span>
      </div>
      {workflow.description && (
        <p className="text-xs text-text-muted line-clamp-2 ml-6">
          {workflow.description}
        </p>
      )}
      <div className="flex items-center gap-2 mt-1.5 ml-6">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {stepCount} step{stepCount !== 1 ? "s" : ""}
        </Badge>
      </div>
    </div>
  );
}
