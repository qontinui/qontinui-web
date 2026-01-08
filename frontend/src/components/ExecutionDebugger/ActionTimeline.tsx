import React, { useRef, useEffect } from "react";
import {
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  AlertCircle,
  CircleDot,
  GitBranch,
  RotateCw,
} from "lucide-react";
import { useExecutionDebugger } from "../../stores/execution-debugger-store";
import { ActionExecutionStatus } from "../../types/debugger/execution-types";
import { SpecialKeyDisplay } from "../special-keys-selector";
import { useAutomation } from "../../contexts/automation-context";
import type { Action } from "../../lib/action-schema/action-types";
import type {
  State,
  StateString,
} from "../../contexts/automation-context/types";

interface ActionTimelineProps {
  actions: Action[];
  onActionClick?: (actionIndex: number) => void;
}

const STATUS_CONFIG: Record<
  ActionExecutionStatus,
  {
    color: string;
    bgColor: string;
    borderColor: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  pending: {
    color: "text-text-muted",
    bgColor: "bg-surface-canvas",
    borderColor: "border-border-subtle",
    icon: CircleDot,
  },
  executing: {
    color: "text-yellow-600",
    bgColor: "bg-yellow-50",
    borderColor: "border-yellow-300",
    icon: Loader2,
  },
  success: {
    color: "text-green-600",
    bgColor: "bg-green-50",
    borderColor: "border-green-300",
    icon: CheckCircle,
  },
  failed: {
    color: "text-red-600",
    bgColor: "bg-red-50",
    borderColor: "border-red-300",
    icon: XCircle,
  },
  skipped: {
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-300",
    icon: AlertCircle,
  },
};

const getActionIcon = (actionType: string) => {
  if (actionType === "IF" || actionType === "SWITCH") return GitBranch;
  if (actionType === "LOOP") return RotateCw;
  return null;
};

// Helper to resolve TYPE action text from StateStrings
const getTypeActionText = (action: Action, states: State[]): string | null => {
  if (action.type !== "TYPE") return null;

  const typeAction = action as Action<"TYPE">;
  const typeConfig = typeAction.config;

  // If using manual text, return it directly
  if (typeConfig.text) {
    return typeConfig.text;
  }

  // If using StateString, resolve the values
  if (typeConfig.textSource) {
    const state = states.find((s) => s.id === typeConfig.textSource!.stateId);
    if (!state || !state.strings) return null;

    if (
      typeConfig.textSource.stringIds &&
      typeConfig.textSource.stringIds.length > 0
    ) {
      const selectedStrings = state.strings
        .filter((s: StateString) =>
          typeConfig.textSource!.stringIds.includes(s.id)
        )
        .map((s: StateString) => s.value)
        .filter((v) => v);

      if (selectedStrings.length > 0) {
        return selectedStrings.join(" | ");
      }
    }
  }

  return null;
};

interface ActionItemProps {
  action: Action;
  index: number;
  isCurrent: boolean;
  status: ActionExecutionStatus;
  duration?: number;
  executionCount: number;
  states: State[];
  onClick?: () => void;
}

const ActionItem: React.FC<ActionItemProps> = ({
  action,
  index,
  isCurrent,
  status,
  duration,
  executionCount,
  states,
  onClick,
}) => {
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;
  const ActionIcon = getActionIcon(action.type);
  const itemRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to current action
  useEffect(() => {
    if (isCurrent && itemRef.current) {
      itemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [isCurrent]);

  const hasBreakpoint = useExecutionDebugger((state) =>
    state.breakpoints.some((bp) => bp.actionIndex === index && bp.enabled)
  );

  return (
    <div
      ref={itemRef}
      className={`relative flex items-center gap-3 p-3 border-l-4 rounded-r transition-all cursor-pointer ${
        config.borderColor
      } ${config.bgColor} ${
        isCurrent ? "ring-2 ring-blue-500 ring-opacity-50" : ""
      } hover:shadow-md`}
      onClick={onClick}
    >
      {/* Breakpoint indicator */}
      {hasBreakpoint && (
        <div className="absolute -left-2 top-1/2 transform -translate-y-1/2">
          <div className="w-4 h-4 bg-red-500 rounded-full border-2 border-white" />
        </div>
      )}

      {/* Execution order */}
      <div
        className={`flex items-center justify-center w-8 h-8 rounded-full border-2 ${
          config.borderColor
        } bg-white font-mono text-sm font-bold ${config.color}`}
      >
        {index + 1}
      </div>

      {/* Action details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {ActionIcon && <ActionIcon className={`w-4 h-4 ${config.color}`} />}
          <span className={`font-semibold text-sm ${config.color}`}>
            {action.type}
          </span>
          {executionCount > 1 && (
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
              {executionCount}x
            </span>
          )}
        </div>
        {(() => {
          const typeText =
            action.type === "TYPE" ? getTypeActionText(action, states) : null;
          const displayText = typeText || action.name;

          if (!displayText) return null;

          return (
            <div className="text-xs text-text-muted truncate">
              {action.type === "TYPE" && typeText ? (
                <SpecialKeyDisplay text={typeText} />
              ) : (
                displayText
              )}
            </div>
          );
        })()}
      </div>

      {/* Status and timing */}
      <div className="flex flex-col items-end gap-1">
        <StatusIcon
          className={`w-5 h-5 ${config.color} ${
            status === "executing" ? "animate-spin" : ""
          }`}
        />
        {duration !== undefined && (
          <div className="flex items-center gap-1 text-xs text-text-muted">
            <Clock className="w-3 h-3" />
            <span>{duration}ms</span>
          </div>
        )}
      </div>
    </div>
  );
};

export const ActionTimeline: React.FC<ActionTimelineProps> = ({
  actions,
  onActionClick,
}) => {
  const { currentActionIndex, actionEvents, toggleBreakpoint } =
    useExecutionDebugger();
  const { states } = useAutomation();

  const getActionStatus = (index: number): ActionExecutionStatus => {
    const event = actionEvents.find((e) => e.actionIndex === index);
    if (!event) {
      return index < currentActionIndex ? "success" : "pending";
    }
    return event.status;
  };

  const getActionDuration = (index: number): number | undefined => {
    const event = actionEvents.find((e) => e.actionIndex === index);
    return event?.duration;
  };

  const getExecutionCount = (index: number): number => {
    const event = actionEvents.find((e) => e.actionIndex === index);
    return event?.executionCount || 0;
  };

  const handleActionClick = (index: number) => {
    if (onActionClick) {
      onActionClick(index);
    }
  };

  const handleActionRightClick = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    toggleBreakpoint(index);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Action Timeline</h3>
          <span className="text-xs text-text-muted">
            {currentActionIndex >= 0 ? currentActionIndex + 1 : 0} /{" "}
            {actions.length}
          </span>
        </div>

        {actions.length === 0 ? (
          <div className="text-center text-text-muted text-sm py-8">
            No actions to display
          </div>
        ) : (
          <div className="space-y-2">
            {actions.map((action, index) => (
              <div
                key={`${action.id}-${index}`}
                onContextMenu={(e) => handleActionRightClick(e, index)}
              >
                <ActionItem
                  action={action}
                  index={index}
                  isCurrent={currentActionIndex === index}
                  status={getActionStatus(index)}
                  duration={getActionDuration(index)}
                  executionCount={getExecutionCount(index)}
                  states={states}
                  onClick={() => handleActionClick(index)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="border-t p-3 bg-surface-canvas">
        <div className="text-xs font-semibold text-text-muted mb-2">Legend</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {Object.entries(STATUS_CONFIG).map(([status, config]) => {
            const Icon = config.icon;
            return (
              <div key={status} className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${config.color}`} />
                <span className="text-text-secondary capitalize">{status}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 pt-2 border-t text-xs text-text-muted">
          Right-click action to toggle breakpoint
        </div>
      </div>
    </div>
  );
};
