import React from "react";
import { Play } from "lucide-react";
import type { TransitionAnimationState } from "@/types/transition-animation";
import type { ActionAnimationConfig } from "@/types/transition-animation";

export function TransitionActionIndicator({
  state,
  currentAction,
}: {
  state: TransitionAnimationState;
  currentAction: ActionAnimationConfig | null;
}) {
  if (state.phase !== "executing-action" || !currentAction) {
    return null;
  }

  return (
    <div className="absolute top-14 left-4 bg-black/80 rounded-lg p-3 z-10">
      <div className="text-xs font-semibold text-cyan-400 flex items-center gap-2">
        <Play className="h-3 w-3" />
        {currentAction.name}
      </div>
      <div className="text-xs text-zinc-400 mt-1">
        Action {state.globalActionIndex + 1} of {state.totalActions}
      </div>
    </div>
  );
}
