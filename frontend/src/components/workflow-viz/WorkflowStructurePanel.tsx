/**
 * Workflow Structure Panel
 *
 * Displays workflow as graph or sequential list
 * Highlights current action and allows manual selection
 */

import React from "react";
import type { Workflow, Action } from "@/lib/action-schema/action-types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle } from "lucide-react";

interface WorkflowStructurePanelProps {
  workflow: Workflow;
  currentActionIndex: number;
  onActionSelect: (index: number, success: boolean) => void;
}

export function WorkflowStructurePanel({
  workflow,
  currentActionIndex,
  onActionSelect,
}: WorkflowStructurePanelProps) {
  const viewMode = workflow.metadata?.viewMode || "sequential";

  // For now, we'll render as a sequential list
  // Graph visualization would require a more complex layout library
  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-1">
        {viewMode === "sequential" || viewMode === "graph" ? (
          <SequentialView
            actions={workflow.actions}
            currentActionIndex={currentActionIndex}
            onActionSelect={onActionSelect}
          />
        ) : (
          <div className="text-center text-muted-foreground py-8">
            Unsupported view mode: {viewMode}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface SequentialViewProps {
  actions: Action[];
  currentActionIndex: number;
  onActionSelect: (index: number, success: boolean) => void;
}

function SequentialView({
  actions,
  currentActionIndex,
  onActionSelect,
}: SequentialViewProps) {
  return (
    <div className="space-y-2">
      {actions.map((action, index) => {
        const isCurrent = index === currentActionIndex;
        const isPast = index < currentActionIndex;

        return (
          <button
            key={action.id}
            onClick={() => onActionSelect(index, true)}
            onContextMenu={(e) => {
              e.preventDefault();
              onActionSelect(index, false);
            }}
            className={`w-full text-left p-3 rounded-lg border transition-all ${
              isCurrent
                ? "border-primary bg-primary/10 shadow-md scale-105"
                : isPast
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-border hover:bg-accent"
            }`}
            title="Left-click for success, right-click for failure"
          >
            {/* Action Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {/* Status Icon */}
                {isPast ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                ) : isCurrent ? (
                  <Circle className="h-4 w-4 text-primary animate-pulse flex-shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}

                {/* Action Number */}
                <Badge
                  variant={isCurrent ? "default" : "outline"}
                  className="text-xs"
                >
                  {index + 1}
                </Badge>

                {/* Action Type */}
                <span
                  className={`font-semibold truncate ${
                    isCurrent
                      ? "text-primary"
                      : isPast
                        ? "text-green-600"
                        : "text-foreground"
                  }`}
                  title={action.type}
                >
                  {action.type}
                </span>
              </div>

              {/* Action Name (if available) */}
              {action.name && (
                <span
                  className="text-xs text-muted-foreground truncate max-w-[100px]"
                  title={action.name}
                >
                  {action.name}
                </span>
              )}
            </div>

            {/* Action Config Summary */}
            <div className="mt-2 text-xs text-muted-foreground">
              {getActionSummary(action)}
            </div>

            {/* Connection Info */}
            {isCurrent && (
              <div className="mt-2 pt-2 border-t border-primary/20">
                <div className="text-xs text-primary font-medium">
                  ← Current Action →
                </div>
              </div>
            )}
          </button>
        );
      })}

      {/* Helper text */}
      <div className="text-xs text-muted-foreground text-center py-4 border-t">
        Left-click: Execute as success • Right-click: Execute as failure
      </div>
    </div>
  );
}

/**
 * Get a human-readable summary of the action configuration
 */
function getActionSummary(action: Action): string {
  const config = action.config as unknown;

  switch (action.type) {
    case "FIND":
      return config?.targetName || "Find target";

    case "CLICK":
      return `Click ${config?.targetName || "target"}`;

    case "TYPE":
      return `Type: "${config?.text?.substring(0, 30) || "..."}"`;

    case "WAIT":
      return `Wait ${config?.duration || 1000}ms`;

    case "GO_TO_STATE":
      const stateIds = config?.stateIds || [];
      return `Activate ${stateIds.length} state(s)`;

    case "IF":
      return `If ${config?.condition || "condition"}`;

    case "LOOP":
      return `Loop ${config?.iterations || "∞"} times`;

    case "SWITCH":
      const cases = config?.cases || [];
      return `Switch: ${cases.length} case(s)`;

    case "SET_VARIABLE":
      return `Set ${config?.variableName || "variable"}`;

    case "GET_VARIABLE":
      return `Get ${config?.variableName || "variable"}`;

    default:
      return action.type.replace(/_/g, " ").toLowerCase();
  }
}
