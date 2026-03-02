import React from "react";
import { Layers } from "lucide-react";
import type { UseTransitionAnimationResult } from "../TransitionAnimationController";
import { getStateColor } from "../TransitionAnimationCanvas-utils";

export function TransitionStateLegend({
  data,
}: {
  data: NonNullable<UseTransitionAnimationResult["data"]>;
}) {
  const originOriginStateIds = new Set(data.originStates.map((s) => s.id));
  const targetStatesNotInOrigin = data.activatedStates.filter(
    (s) => !originOriginStateIds.has(s.id)
  );

  return (
    <div className="absolute bottom-4 left-4 bg-black/80 rounded-lg p-3 z-10 max-w-xs">
      <div className="text-xs font-semibold text-white mb-2 flex items-center gap-2">
        <Layers className="h-3 w-3" />
        States
      </div>
      <div className="space-y-1">
        {data.originStates.map((state, i) => (
          <div key={state.id} className="flex items-center gap-2 text-xs">
            <div
              className="w-3 h-3 rounded"
              style={{ backgroundColor: getStateColor(i).border }}
            />
            <span className="text-zinc-300">{state.name}</span>
            <span className="text-zinc-500">(origin)</span>
          </div>
        ))}
        {targetStatesNotInOrigin.map((state, i) => (
          <div key={state.id} className="flex items-center gap-2 text-xs">
            <div
              className="w-3 h-3 rounded border-2 border-dashed"
              style={{
                borderColor: getStateColor(i + data.originStates.length).border,
              }}
            />
            <span className="text-zinc-300">{state.name}</span>
            <span className="text-zinc-500">(target)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
