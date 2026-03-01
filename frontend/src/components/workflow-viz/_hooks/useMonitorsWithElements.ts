import { useMemo } from "react";
import type { State } from "@/contexts/automation-context/types";
import type { CanvasMode } from "../ActiveStatesCanvas-types";

/**
 * Computes which monitor indices have positioned elements for the active states.
 * Extracted so it can run before useMonitorCanvas (which needs this data),
 * without creating a circular dependency with useActiveStatesData.
 */
export function useMonitorsWithElements(
  states: State[],
  mode: CanvasMode,
  activeStateIds?: Set<string> | string[]
): number[] {
  // Normalize activeStateIds to a Set
  const activeStateIdsSet = useMemo(() => {
    if (!activeStateIds) {
      if (mode === "config") {
        return new Set(states.map((s) => s.id));
      }
      return new Set<string>();
    }
    return activeStateIds instanceof Set
      ? activeStateIds
      : new Set(activeStateIds);
  }, [activeStateIds, mode, states]);

  return useMemo(() => {
    const monitorIndices = new Set<number>();

    states.forEach((state) => {
      if (!activeStateIdsSet.has(state.id)) return;

      state.stateImages?.forEach((stateImage) => {
        const monitorIndex = stateImage.monitors?.[0] ?? 0;
        const hasPosition = stateImage.patterns?.some(
          (p) =>
            (p.offsetX !== undefined && p.offsetY !== undefined) ||
            p.searchRegions?.some(
              (sr) => sr.x !== undefined && sr.y !== undefined
            )
        );
        if (hasPosition) {
          monitorIndices.add(monitorIndex);
        }
      });
    });

    return Array.from(monitorIndices);
  }, [states, activeStateIdsSet]);
}
