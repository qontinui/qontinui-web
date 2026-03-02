import type {
  Transition,
  State,
  ImageAsset,
} from "@/contexts/automation-context/types";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { Monitor } from "@/lib/schemas/geometry";
import type { UseTransitionAnimationResult } from "./TransitionAnimationController";

export interface TransitionAnimationCanvasProps {
  transition: Transition | null;
  states: State[];
  workflows: Workflow[];
  images: ImageAsset[];
  monitors?: Monitor[];
  className?: string;
  animation?: UseTransitionAnimationResult;
  /** @deprecated Use animation prop instead */
  controllerRef?: React.MutableRefObject<UseTransitionAnimationResult | null>;
  showMonitorFilter?: boolean;
}

export const DEFAULT_WIDTH = 1920;
export const DEFAULT_HEIGHT = 1080;

export const STATE_COLORS = [
  { border: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)", name: "blue" },
  { border: "#22c55e", bg: "rgba(34, 197, 94, 0.15)", name: "green" },
  { border: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)", name: "amber" },
  { border: "#ec4899", bg: "rgba(236, 72, 153, 0.15)", name: "pink" },
  { border: "#8b5cf6", bg: "rgba(139, 92, 246, 0.15)", name: "purple" },
  { border: "#ef4444", bg: "rgba(239, 68, 68, 0.15)", name: "red" },
  { border: "#06b6d4", bg: "rgba(6, 182, 212, 0.15)", name: "cyan" },
  { border: "#84cc16", bg: "rgba(132, 204, 22, 0.15)", name: "lime" },
];
