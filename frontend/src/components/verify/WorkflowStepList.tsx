/**
 * WorkflowStepList Component
 *
 * Displays a list of workflow steps (actions) with the ability to select individual steps.
 * Highlights the currently selected step.
 */

import React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  MousePointer2,
  Type,
  Search,
  EyeOff,
  GitBranch,
  RotateCw,
  Play,
  Navigation,
  Hand,
  Keyboard,
  MousePointerClick,
} from "lucide-react";
import type { Workflow, Action } from "@/lib/action-schema/action-types";

export interface WorkflowStepListProps {
  workflow: Workflow;
  currentStep: number;
  onStepSelect: (step: number) => void;
}

/**
 * Get an appropriate icon for each action type
 */
function getActionIcon(actionType: string) {
  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    CLICK: MousePointerClick,
    DOUBLE_CLICK: MousePointerClick,
    RIGHT_CLICK: MousePointerClick,
    TYPE: Type,
    FIND: Search,
    VANISH: EyeOff,
    GO_TO_STATE: Navigation,
    RUN_WORKFLOW: Play,
    DRAG: Hand,
    SCROLL: MousePointer2,
    MOUSE_MOVE: MousePointer2,
    MOUSE_DOWN: MousePointer2,
    MOUSE_UP: MousePointer2,
    KEY_PRESS: Keyboard,
    KEY_DOWN: Keyboard,
    KEY_UP: Keyboard,
    IF: GitBranch,
    LOOP: RotateCw,
  };

  return iconMap[actionType] || Play;
}

/**
 * Get a display-friendly name for the action
 */
function getActionDisplayName(action: Action, _index: number): string {
  // Use custom name if provided
  if (action.name) {
    return action.name;
  }

  // Generate a descriptive name based on action type and config
  const type = action.type;

  switch (type) {
    case "CLICK":
      return "Click Action";

    case "TYPE": {
      const typeAction = action as Action<"TYPE">;
      if (typeAction.config.text) {
        const truncated =
          typeAction.config.text.length > 20
            ? typeAction.config.text.substring(0, 20) + "..."
            : typeAction.config.text;
        return `Type "${truncated}"`;
      }
      return "Type Text";
    }

    case "FIND": {
      const findAction = action as Action<"FIND">;
      if (findAction.config.target?.type === "stateImage") {
        return "Find State";
      }
      return "Find Element";
    }

    case "VANISH":
      return "Wait for Vanish";

    case "GO_TO_STATE": {
      const gotoAction = action as Action<"GO_TO_STATE">;
      if (gotoAction.config.stateIds && gotoAction.config.stateIds.length > 0) {
        return `Go to ${gotoAction.config.stateIds[0]}`;
      }
      return "Go to State";
    }

    case "RUN_WORKFLOW":
      return "Run Workflow";

    case "DRAG":
      return "Drag";

    case "SCROLL": {
      const scrollAction = action as Action<"SCROLL">;
      return `Scroll ${scrollAction.config.direction || "down"}`;
    }

    case "IF":
      return "If Condition";

    case "LOOP":
      return "Loop";

    default:
      return type.replace(/_/g, " ");
  }
}

export function WorkflowStepList({
  workflow,
  currentStep,
  onStepSelect,
}: WorkflowStepListProps) {
  if (!workflow || !workflow.actions || workflow.actions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No actions in workflow
      </div>
    );
  }

  return (
    <ScrollArea className="h-[600px] pr-4">
      <div className="space-y-2">
        {workflow.actions.map((action, index) => {
          const Icon = getActionIcon(action.type);
          const displayName = getActionDisplayName(action, index);
          const isActive = index === currentStep;

          return (
            <button
              key={action.id || index}
              onClick={() => onStepSelect(index)}
              className={cn(
                "w-full text-left p-3 rounded-lg transition-all",
                "flex items-start gap-3",
                "border",
                isActive
                  ? "bg-[#00D9FF]/10 border-[#00D9FF]/50 text-[#00D9FF]"
                  : "bg-[#1A1A1B]/30 border-gray-800 text-gray-400 hover:bg-[#1A1A1B]/50 hover:border-gray-700"
              )}
            >
              <div className="flex-shrink-0 mt-0.5">
                <div
                  className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                    isActive
                      ? "bg-[#00D9FF] text-black"
                      : "bg-gray-800 text-gray-500"
                  )}
                >
                  {index + 1}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="font-medium text-sm truncate">
                    {displayName}
                  </span>
                </div>

                <div className="text-xs opacity-75">{action.type}</div>
              </div>

              {isActive && (
                <div className="flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-[#00D9FF] animate-pulse" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
