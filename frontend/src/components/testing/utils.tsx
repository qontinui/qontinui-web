import React from "react";
import { MousePointer2, Keyboard, Move, Eye, AlertCircle } from "lucide-react";
import type {
  ExecutionStep,
  ActionStep,
  PlaybackFrame,
  ActionAnimation,
} from "@/types/integration-testing";

export function resolveName(id: string, nameMap?: Map<string, string>): string {
  return nameMap?.get(id) ?? id;
}

export function formatDuration(ms: number): string {
  if (ms === 0) return "0ms (virtual)";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
}

export function getActionIcon(step: ActionStep): React.ReactNode {
  switch (step.action_type) {
    case "click":
      return <MousePointer2 className="w-16 h-16 text-green-400" />;
    case "type":
      return <Keyboard className="w-16 h-16 text-yellow-400" />;
    case "drag":
      return <Move className="w-16 h-16 text-orange-400" />;
    case "find":
      return <Eye className="w-16 h-16 text-blue-400" />;
    default:
      return <AlertCircle className="w-16 h-16 text-text-muted" />;
  }
}

export function generatePlaybackFrame(
  step: ExecutionStep,
  index: number
): PlaybackFrame {
  const frame: PlaybackFrame = {
    step_index: index,
    step_type: step.type,
    screenshot_url: null,
    active_states: [],
    timestamp: step.timestamp,
    highlight_regions: [],
  };

  switch (step.type) {
    case "state_discovery":
      frame.active_states = step.active_states;
      break;
    case "path_calculation":
      frame.active_states = step.current_states;
      break;
    case "action":
      frame.screenshot_url = step.screenshot_url || null;
      frame.active_states = step.from_states;
      if (step.match_location) {
        frame.highlight_regions.push({
          x: step.match_location.x,
          y: step.match_location.y,
          width: step.match_location.width,
          height: step.match_location.height,
          label: step.pattern_name,
          color: step.result.success ? "#22C55E" : "#EF4444",
          style: "solid",
        });
      }
      break;
    case "state_update":
      frame.active_states = step.new_active_states;
      break;
  }

  return frame;
}

export function getAnimationForAction(
  step: ActionStep
): ActionAnimation | null {
  const location = step.match_location;

  switch (step.action_type) {
    case "click":
      return location
        ? {
            animation_type: "click_ripple",
            start_position: {
              x: location.x + location.width / 2,
              y: location.y + location.height / 2,
            },
            duration_ms: 500,
          }
        : null;

    case "type":
      return location
        ? {
            animation_type: "type_indicator",
            start_position: { x: location.x, y: location.y },
            text: step.input_data?.text || "...",
            duration_ms: 1000,
          }
        : null;

    case "drag":
      return step.input_data?.from && step.input_data?.to
        ? {
            animation_type: "drag_path",
            start_position: step.input_data.from,
            end_position: step.input_data.to,
            duration_ms: 800,
          }
        : null;

    case "scroll":
      return location
        ? {
            animation_type: "scroll_indicator",
            start_position: {
              x: location.x + location.width / 2,
              y: location.y + location.height / 2,
            },
            duration_ms: 600,
          }
        : null;

    default:
      return null;
  }
}
