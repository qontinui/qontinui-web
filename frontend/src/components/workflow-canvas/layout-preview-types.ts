import type { Workflow } from "@/lib/action-schema/action-types";
import type { LayoutComparison } from "@/services/layout-statistics";

export interface LayoutPreviewProps {
  beforeWorkflow: Workflow;
  afterWorkflow: Workflow;
  comparison: LayoutComparison;
  mode?: ViewMode;
  width?: number;
  height?: number;
  showStats?: boolean;
  showChangedNodes?: boolean;
  interactive?: boolean;
}

export type ViewMode =
  | "side-by-side"
  | "overlay"
  | "before-only"
  | "after-only";

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}
