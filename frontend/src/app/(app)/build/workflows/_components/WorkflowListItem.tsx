"use client";

import { Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Minimal row shape — matches both the web-PG mirror's list payload AND
 * the legacy UnifiedWorkflow shape so the same component renders either.
 *
 * Step count is computed only when ``definition`` (full UnifiedWorkflow)
 * is present; the mirror list omits ``definition`` to keep payloads
 * light. When omitted we don't render the step-count badge.
 */
interface WorkflowRowLike {
  id: string;
  name: string;
  description?: string;
  setupSteps?: unknown[];
  verificationSteps?: unknown[];
  agenticSteps?: unknown[];
  completionSteps?: unknown[];
}

export function WorkflowListItem({
  workflow,
  isSelected,
  onClick,
}: {
  workflow: WorkflowRowLike;
  isSelected: boolean;
  onClick: () => void;
}) {
  const stepCount =
    (workflow.setupSteps?.length ?? 0) +
    (workflow.verificationSteps?.length ?? 0) +
    (workflow.agenticSteps?.length ?? 0) +
    (workflow.completionSteps?.length ?? 0);
  const hasStepData =
    workflow.setupSteps !== undefined ||
    workflow.verificationSteps !== undefined ||
    workflow.agenticSteps !== undefined ||
    workflow.completionSteps !== undefined;

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
      {hasStepData && (
        <div className="flex items-center gap-2 mt-1.5 ml-6">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {stepCount} step{stepCount !== 1 ? "s" : ""}
          </Badge>
        </div>
      )}
    </div>
  );
}
