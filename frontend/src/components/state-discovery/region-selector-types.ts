/**
 * Types for the RegionSelector component
 */

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionSelectorProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onRegionSelect: (region: Region | null | undefined) => void;
  initialRegion?: Region;
}

export type DragHandle =
  | "none"
  | "move"
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

export const CURSOR_MAP: Record<DragHandle, string> = {
  none: "crosshair",
  move: "move",
  nw: "nw-resize",
  n: "n-resize",
  ne: "ne-resize",
  e: "e-resize",
  se: "se-resize",
  s: "s-resize",
  sw: "sw-resize",
  w: "w-resize",
};
