export interface BoundingBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  color?: string;
}

export interface ImageCanvasProps {
  imageUrl: string;
  boxes: BoundingBox[];
  selectedBoxId?: string | null;
  onBoxesChange?: (boxes: BoundingBox[]) => void;
  onBoxSelect?: (boxId: string | null) => void;
  minBoxSize?: number;
  maxZoom?: number;
  minZoom?: number;
  readonly?: boolean;
  showControls?: boolean;
  className?: string;
}

export type ResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "inside"
  | null;

export const CURSORS: Record<
  Exclude<ResizeHandle, null> | "default" | "null",
  string
> = {
  nw: "nw-resize",
  n: "n-resize",
  ne: "ne-resize",
  e: "e-resize",
  se: "se-resize",
  s: "s-resize",
  sw: "sw-resize",
  w: "w-resize",
  inside: "move",
  default: "crosshair",
  null: "default",
};
