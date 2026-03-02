"use client";

import type {
  DiscoveredState,
  StateImage,
  StateTransition,
} from "@/types/state-machine";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, MousePointer } from "lucide-react";

interface TransitionListItemProps {
  transition: StateTransition;
  stateMap: Map<string, DiscoveredState>;
  imageMap: Map<string, StateImage>;
  onClick?: () => void;
}

export function TransitionListItem({
  transition,
  stateMap,
  imageMap,
  onClick,
}: TransitionListItemProps) {
  const fromState = stateMap.get(transition.fromStateId);
  const toState = stateMap.get(transition.toStateId);
  // triggerImage available for future use (e.g., showing thumbnail)
  const _triggerImage = transition.trigger?.imageId
    ? imageMap.get(transition.trigger.imageId)
    : undefined;
  void _triggerImage; // Suppress unused variable warning

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle bg-surface-default/50 hover:bg-surface-default cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="flex-1 flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1">
          <div className="flex-1 text-right">
            <span className="font-medium">
              {fromState?.name || transition.fromStateId}
            </span>
          </div>
          <ArrowRight className="h-4 w-4 text-text-muted flex-shrink-0" />
          <div className="flex-1">
            <span className="font-medium">
              {toState?.name || transition.toStateId}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {transition.trigger && (
          <Badge variant="outline" className="flex items-center gap-1">
            <MousePointer className="h-3 w-3" />
            {transition.trigger.type}
          </Badge>
        )}
        <Badge variant="outline" className="text-xs">
          {Math.round(transition.confidence * 100)}%
        </Badge>
      </div>
    </div>
  );
}
