/**
 * ActiveStatesChecklist Component
 *
 * Displays a checklist of all states, indicating which ones are currently active.
 * Provides a quick overview of the state activation status at the current workflow step.
 */

import React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, Circle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { State } from "@/stores/automation";

export interface ActiveStatesChecklistProps {
  allStates: State[];
  activeStateIds: string[];
}

/**
 * Get state metadata for display
 */
function getStateMetadata(state: State): string {
  const parts: string[] = [];

  if (state.stateImages && state.stateImages.length > 0) {
    parts.push(
      `${state.stateImages.length} image${state.stateImages.length > 1 ? "s" : ""}`
    );
  }

  if (state.regions && state.regions.length > 0) {
    parts.push(
      `${state.regions.length} region${state.regions.length > 1 ? "s" : ""}`
    );
  }

  if (state.locations && state.locations.length > 0) {
    parts.push(
      `${state.locations.length} location${state.locations.length > 1 ? "s" : ""}`
    );
  }

  return parts.join(", ") || "No elements";
}

export function ActiveStatesChecklist({
  allStates,
  activeStateIds,
}: ActiveStatesChecklistProps) {
  if (!allStates || allStates.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <div>No states defined</div>
        <div className="text-xs text-gray-600 mt-1">
          Create states in the automation builder
        </div>
      </div>
    );
  }

  // Sort states: active first, then by name
  const sortedStates = [...allStates].sort((a, b) => {
    const aActive = activeStateIds.includes(a.id);
    const bActive = activeStateIds.includes(b.id);

    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;

    return a.name.localeCompare(b.name);
  });

  const activeCount = activeStateIds.length;
  const totalCount = allStates.length;

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500">
          {activeCount} of {totalCount} active
        </span>
        {activeCount > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-[#00D9FF] animate-pulse" />
            <span className="text-[#00D9FF]">Active</span>
          </div>
        )}
      </div>

      {/* States List */}
      <ScrollArea className="h-[550px] pr-4">
        <div className="space-y-2">
          {sortedStates.map((state) => {
            const isActive = activeStateIds.includes(state.id);
            const metadata = getStateMetadata(state);

            return (
              <div
                key={state.id}
                className={cn(
                  "p-3 rounded-lg border transition-all",
                  isActive
                    ? "bg-[#00D9FF]/10 border-[#00D9FF]/50"
                    : "bg-[#1A1A1B]/30 border-gray-800"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {isActive ? (
                      <CheckCircle2 className="w-5 h-5 text-[#00D9FF]" />
                    ) : (
                      <Circle className="w-5 h-5 text-gray-600" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div
                      className={cn(
                        "font-medium text-sm mb-1",
                        isActive ? "text-[#00D9FF]" : "text-gray-400"
                      )}
                    >
                      {state.name}
                    </div>

                    {state.description && (
                      <div className="text-xs text-gray-500 mb-1 line-clamp-2">
                        {state.description}
                      </div>
                    )}

                    <div className="text-xs text-gray-600">{metadata}</div>

                    {/* State flags */}
                    <div className="flex items-center gap-2 mt-2">
                      {state.initial && (
                        <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                          Initial
                        </span>
                      )}
                      {state.isFinal && (
                        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
                          Final
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Help Text */}
      {activeCount === 0 && (
        <div className="text-xs text-gray-600 text-center p-4 bg-[#1A1A1B]/30 rounded border border-gray-800">
          <Info className="w-4 h-4 mx-auto mb-1 opacity-50" />
          No states are currently active. States become active as the workflow
          progresses through GO_TO_STATE and Find State actions.
        </div>
      )}
    </div>
  );
}
