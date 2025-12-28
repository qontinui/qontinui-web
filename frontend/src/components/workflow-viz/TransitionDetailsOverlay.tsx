"use client";

/**
 * Transition Details Overlay
 *
 * Shows detailed information about the current transition animation state.
 */

import React from "react";
import type {
  Transition,
  OutgoingTransition,
  IncomingTransition,
  State,
} from "@/contexts/automation-context/types";
import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  TransitionAnimationState,
  ActionAnimationConfig,
} from "@/types/transition-animation";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  ArrowDown,
  Play,
  Pause,
  CheckCircle,
  Circle,
  Eye,
  EyeOff,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TransitionDetailsOverlayProps {
  /** The transition being visualized */
  transition: Transition;
  /** Animation state */
  animationState: TransitionAnimationState;
  /** Current action being animated */
  currentAction: ActionAnimationConfig | null;
  /** All states for name resolution */
  states: State[];
  /** All workflows for details */
  workflows: Workflow[];
  /** Additional class names */
  className?: string;
}

export function TransitionDetailsOverlay({
  transition,
  animationState,
  currentAction,
  states,
  workflows,
  className,
}: TransitionDetailsOverlayProps) {
  // Resolve state ID to name
  const getStateName = (stateId: string): string => {
    const state = states.find((s) => s.id === stateId);
    return state?.name || stateId;
  };

  // Get workflow name
  const getWorkflowName = (workflowId: string): string => {
    const workflow = workflows.find((w) => w.id === workflowId);
    return workflow?.name || workflowId;
  };

  const isOutgoing = transition.type === "OutgoingTransition";
  const outgoing = isOutgoing ? (transition as OutgoingTransition) : null;
  const incoming = !isOutgoing ? (transition as IncomingTransition) : null;

  return (
    <div
      className={cn(
        "bg-zinc-900/95 backdrop-blur-sm rounded-lg border border-zinc-800 p-4 space-y-4",
        className
      )}
    >
      {/* Transition type header */}
      <div className="flex items-center gap-2">
        {isOutgoing ? (
          <ArrowRight className="h-5 w-5 text-fuchsia-500" />
        ) : (
          <ArrowDown className="h-5 w-5 text-green-500" />
        )}
        <span className="font-semibold text-white">
          {isOutgoing ? "Outgoing Transition" : "Incoming Transition"}
        </span>
      </div>

      {/* State flow */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
          State Flow
        </div>

        {outgoing && (
          <div className="flex items-start gap-2">
            {/* From state */}
            <div className="flex-1">
              <div className="text-xs text-zinc-500 mb-1">From</div>
              <div className="flex items-center gap-2">
                <StateIndicator
                  active={
                    animationState.phase === "showing-initial" ||
                    animationState.phase === "executing-action"
                  }
                  exiting={animationState.phase === "transitioning-states"}
                />
                <span className="text-sm font-medium">
                  {getStateName(outgoing.fromState)}
                </span>
                {outgoing.staysVisible && (
                  <Badge variant="secondary" className="h-4 text-xs">
                    <Eye className="h-2.5 w-2.5 mr-0.5" />
                    stays
                  </Badge>
                )}
              </div>
            </div>

            {/* Arrow */}
            <ArrowRight className="h-4 w-4 text-zinc-600 mt-6" />

            {/* To states */}
            <div className="flex-1">
              <div className="text-xs text-zinc-500 mb-1">To</div>
              <div className="space-y-1">
                {outgoing.activateStates.map((stateId) => (
                  <div key={stateId} className="flex items-center gap-2">
                    <StateIndicator
                      active={
                        animationState.phase === "showing-final" ||
                        animationState.phase === "completed"
                      }
                      entering={animationState.phase === "transitioning-states"}
                    />
                    <span className="text-sm font-medium">
                      {getStateName(stateId)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {incoming && (
          <div className="flex items-center gap-2">
            <StateIndicator
              active={
                animationState.phase === "showing-final" ||
                animationState.phase === "completed"
              }
              entering={animationState.phase === "transitioning-states"}
            />
            <span className="text-sm font-medium">
              {getStateName(incoming.toState)}
            </span>
          </div>
        )}

        {/* Deactivated states */}
        {outgoing && outgoing.deactivateStates.length > 0 && (
          <div className="mt-2">
            <div className="text-xs text-zinc-500 mb-1 flex items-center gap-1">
              <EyeOff className="h-3 w-3" />
              Deactivates
            </div>
            <div className="flex flex-wrap gap-1">
              {outgoing.deactivateStates.map((stateId) => (
                <Badge
                  key={stateId}
                  variant="outline"
                  className="text-xs text-red-400 border-red-400/50"
                >
                  {getStateName(stateId)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Workflows */}
      {transition.workflows.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-1">
            <WorkflowIcon className="h-3 w-3" />
            Workflows
          </div>
          <div className="space-y-1">
            {transition.workflows.map((workflowId, index) => {
              const workflow = workflows.find((w) => w.id === workflowId);
              const isCurrent =
                animationState.phase === "executing-action" &&
                animationState.currentWorkflowIndex === index;

              return (
                <div
                  key={workflowId}
                  className={cn(
                    "flex items-center gap-2 text-sm py-1 px-2 rounded",
                    isCurrent && "bg-primary/20"
                  )}
                >
                  {isCurrent ? (
                    <Play className="h-3 w-3 text-primary" />
                  ) : (
                    <Circle className="h-3 w-3 text-zinc-600" />
                  )}
                  <span
                    className={cn(
                      isCurrent ? "text-primary font-medium" : "text-zinc-400"
                    )}
                  >
                    {getWorkflowName(workflowId)}
                  </span>
                  <span className="text-xs text-zinc-600">
                    ({workflow?.actions?.length || 0} actions)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Current action */}
      {currentAction && animationState.phase === "executing-action" && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
            Current Action
          </div>
          <div className="flex items-center gap-2 bg-primary/10 rounded-lg p-2">
            <Play className="h-4 w-4 text-primary" />
            <div>
              <div className="text-sm font-medium text-white">
                {currentAction.name}
              </div>
              <div className="text-xs text-zinc-400">
                {currentAction.type} - {animationState.globalActionIndex + 1} of{" "}
                {animationState.totalActions}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Animation status */}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <div className="flex items-center gap-2">
          {animationState.isPlaying ? (
            <>
              <Play className="h-3 w-3 text-green-500" />
              <span>Playing</span>
            </>
          ) : animationState.phase === "completed" ? (
            <>
              <CheckCircle className="h-3 w-3 text-green-500" />
              <span>Completed</span>
            </>
          ) : (
            <>
              <Pause className="h-3 w-3" />
              <span>Paused</span>
            </>
          )}
        </div>
        <div>{animationState.playbackSpeed}x speed</div>
      </div>
    </div>
  );
}

// Helper component for state indicators
function StateIndicator({
  active,
  entering,
  exiting,
}: {
  active?: boolean;
  entering?: boolean;
  exiting?: boolean;
}) {
  return (
    <div
      className={cn(
        "w-3 h-3 rounded-full border-2 transition-all",
        active && "bg-green-500 border-green-500",
        entering && "bg-green-500/50 border-green-500 animate-pulse",
        exiting && "bg-red-500/50 border-red-500 animate-pulse",
        !active && !entering && !exiting && "border-zinc-600"
      )}
    />
  );
}

export default TransitionDetailsOverlay;
