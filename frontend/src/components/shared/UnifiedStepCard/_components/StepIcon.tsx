"use client";

import {
  Compass,
  Route,
  RefreshCw,
  Play,
  MousePointer2,
  Keyboard,
  Move,
  Eye,
  Image as ImageIcon,
  ArrowRight,
  Clock,
  Layers,
} from "lucide-react";
import type { UnifiedExecutionStep } from "@/types/tree-events";
import { getStepTypeIcon } from "@/lib/tree-event-adapter";

interface StepIconProps {
  step: UnifiedExecutionStep;
}

/**
 * Renders the appropriate icon for a step based on its type.
 */
export function StepIcon({ step }: StepIconProps) {
  const iconName = getStepTypeIcon(step);
  const base = "w-5 h-5";

  switch (iconName) {
    case "compass":
      return <Compass className={`${base} text-blue-400`} />;
    case "route":
      return <Route className={`${base} text-purple-400`} />;
    case "refresh-cw":
      return <RefreshCw className={`${base} text-cyan-400`} />;
    case "mouse-pointer-2":
      return <MousePointer2 className={`${base} text-green-400`} />;
    case "keyboard":
      return <Keyboard className={`${base} text-yellow-400`} />;
    case "eye":
      return <Eye className={`${base} text-blue-400`} />;
    case "move":
      return <Move className={`${base} text-orange-400`} />;
    case "camera":
      return <ImageIcon className={`${base} text-pink-400`} />;
    case "clock":
      return <Clock className={`${base} text-text-muted`} />;
    case "layers":
      return <Layers className={`${base} text-purple-400`} />;
    case "arrow-right":
      return <ArrowRight className={`${base} text-cyan-400`} />;
    default:
      return <Play className={`${base} text-text-muted`} />;
  }
}
