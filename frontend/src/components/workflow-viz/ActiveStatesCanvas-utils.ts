import type { State } from "@/contexts/automation-context/types";
import type { Monitor } from "@/lib/schemas/geometry";
import type { StateColor } from "./ActiveStatesCanvas-types";

// Default canvas dimensions (single monitor fallback)
export const DEFAULT_WIDTH = 1920;
export const DEFAULT_HEIGHT = 1080;

export const DEFAULT_MONITORS: Monitor[] = [];

// Distinct colors for states - solid colors for borders and text
export const STATE_COLORS: StateColor[] = [
  { border: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)", name: "blue" },
  { border: "#22c55e", bg: "rgba(34, 197, 94, 0.15)", name: "green" },
  { border: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)", name: "amber" },
  { border: "#ec4899", bg: "rgba(236, 72, 153, 0.15)", name: "pink" },
  { border: "#8b5cf6", bg: "rgba(139, 92, 246, 0.15)", name: "purple" },
  { border: "#ef4444", bg: "rgba(239, 68, 68, 0.15)", name: "red" },
  { border: "#06b6d4", bg: "rgba(6, 182, 212, 0.15)", name: "cyan" },
  { border: "#84cc16", bg: "rgba(132, 204, 22, 0.15)", name: "lime" },
];

// Build a map of imageId -> stateId for quick lookups
export function buildImageToStateMap(
  states: State[]
): Map<string, { stateId: string; stateName: string; imageLabel: string }> {
  const map = new Map<
    string,
    { stateId: string; stateName: string; imageLabel: string }
  >();

  states.forEach((state) => {
    state.stateImages?.forEach((stateImage) => {
      stateImage.patterns?.forEach((pattern) => {
        if (pattern.imageId) {
          map.set(pattern.imageId, {
            stateId: state.id,
            stateName: state.name,
            imageLabel: stateImage.name || pattern.name || "Image",
          });
        }
      });
    });
  });

  return map;
}
