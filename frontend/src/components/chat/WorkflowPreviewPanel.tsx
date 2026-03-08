"use client";

import {
  X,
  Play,
  Pencil,
  RefreshCw,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Terminal,
  Monitor,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";
import type {
  UnifiedWorkflow,
  UnifiedStep,
  WorkflowPhase,
} from "@/types/unified-workflow";

interface WorkflowPreviewPanelProps {
  workflow: UnifiedWorkflow | null;
  isLoading: boolean;
  error?: string;
  onExecute: () => void;
  onEditInBuilder: () => void;
  onRegenerate: () => void;
  onSave: () => void;
  onClose: () => void;
}

const PHASE_COLORS: Record<
  string,
  { bg: string; border: string; text: string; badge: string }
> = {
  setup: {
    bg: "bg-blue-950/30",
    border: "border-blue-800/50",
    text: "text-blue-400",
    badge: "bg-blue-900/50 text-blue-300",
  },
  verification: {
    bg: "bg-green-950/30",
    border: "border-green-800/50",
    text: "text-green-400",
    badge: "bg-green-900/50 text-green-300",
  },
  agentic: {
    bg: "bg-amber-950/30",
    border: "border-amber-800/50",
    text: "text-amber-400",
    badge: "bg-amber-900/50 text-amber-300",
  },
  completion: {
    bg: "bg-purple-950/30",
    border: "border-purple-800/50",
    text: "text-purple-400",
    badge: "bg-purple-900/50 text-purple-300",
  },
};

const STEP_ICONS: Record<string, React.ElementType> = {
  command: Terminal,
  ui_bridge: Monitor,
  prompt: Bot,
};

export function WorkflowPreviewPanel({
  workflow,
  isLoading,
  error,
  onExecute,
  onEditInBuilder,
  onRegenerate,
  onSave,
  onClose,
}: WorkflowPreviewPanelProps) {
  return (
    <div className="flex flex-col h-full border-l border-border-subtle/50 bg-surface-canvas/95">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle/50">
        <h3 className="text-sm font-semibold text-text-primary">
          Generated Workflow
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-6 w-6 p-0 text-text-muted hover:text-text-primary"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && (
          <div className="flex flex-col items-center justify-center h-48 text-text-muted">
            <Loader2 className="size-8 animate-spin mb-3 text-purple-400" />
            <p className="text-sm">Generating workflow...</p>
            <p className="text-xs mt-1 opacity-60">This may take a minute</p>
          </div>
        )}

        {error && !isLoading && (
          <div className="flex flex-col items-center justify-center h-48 text-red-400">
            <AlertCircle className="size-8 mb-3" />
            <p className="text-sm font-medium">Generation Failed</p>
            <p className="text-xs mt-1 opacity-60 text-center max-w-[250px]">
              {error}
            </p>
          </div>
        )}

        {workflow && !isLoading && (
          <div className="space-y-3">
            {/* Workflow name and description */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-text-primary">
                {workflow.name}
              </h4>
              {workflow.description && (
                <p className="text-xs text-text-muted mt-1">
                  {workflow.description}
                </p>
              )}
              {workflow.tags && workflow.tags.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {workflow.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Phases */}
            {(["setup", "verification", "agentic", "completion"] as const).map(
              (phase) => {
                const steps = getStepsForPhase(workflow, phase);
                if (steps.length === 0) return null;
                return (
                  <PreviewPhaseSection
                    key={phase}
                    phase={phase}
                    steps={steps}
                  />
                );
              }
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {workflow && !isLoading && (
        <div className="border-t border-border-subtle/50 p-4 space-y-2">
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={onExecute}
              className="flex-1 bg-green-700 hover:bg-green-600 text-white gap-1.5"
            >
              <Play className="size-3.5" />
              Execute
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onEditInBuilder}
              className="flex-1 gap-1.5"
            >
              <Pencil className="size-3.5" />
              Edit in Builder
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRegenerate}
              className="flex-1 gap-1.5 text-xs"
            >
              <RefreshCw className="size-3" />
              Regenerate
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onSave}
              className="flex-1 gap-1.5 text-xs"
            >
              <Save className="size-3" />
              Save to Library
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewPhaseSection({
  phase,
  steps,
}: {
  phase: WorkflowPhase;
  steps: UnifiedStep[];
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const colors = (PHASE_COLORS[phase] ?? PHASE_COLORS["setup"])!;

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className={`rounded-lg border ${colors.border} ${colors.bg}`}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between px-3 py-2 cursor-pointer">
            <div className="flex items-center gap-2">
              {isExpanded ? (
                <ChevronDown className={`w-3.5 h-3.5 ${colors.text}`} />
              ) : (
                <ChevronRight className={`w-3.5 h-3.5 ${colors.text}`} />
              )}
              <span
                className={`text-xs font-semibold uppercase tracking-wider ${colors.text}`}
              >
                {phase}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${colors.badge}`}
              >
                {steps.length}
              </span>
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-2 pb-2 space-y-1">
            {steps.map((step, i) => {
              const Icon = STEP_ICONS[step.type] || Bot;
              return (
                <div
                  key={step.id || i}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-black/20"
                >
                  <Icon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-200 truncate">
                      {step.name}
                    </div>
                  </div>
                  <CheckCircle2 className="w-3 h-3 text-zinc-600" />
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function getStepsForPhase(
  workflow: UnifiedWorkflow,
  phase: WorkflowPhase
): UnifiedStep[] {
  switch (phase) {
    case "setup":
      return (workflow.setup_steps as UnifiedStep[]) || [];
    case "verification":
      return (workflow.verification_steps as UnifiedStep[]) || [];
    case "agentic":
      return (workflow.agentic_steps as UnifiedStep[]) || [];
    case "completion":
      return (workflow.completion_steps as UnifiedStep[]) || [];
    default:
      return [];
  }
}
