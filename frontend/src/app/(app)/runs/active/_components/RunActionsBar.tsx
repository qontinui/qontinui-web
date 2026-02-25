"use client";

import type { TaskRun } from "@/lib/runner-api";
import { ControlBar } from "@/components/active-dashboard/ControlBar";
import { BottomBar } from "@/components/active-dashboard/BottomBar";

interface RunActionsBarProps {
  run: TaskRun;
  onRefresh: () => void;
  position: "top" | "bottom";
}

/**
 * Renders the control/action bars (top control bar or bottom status bar).
 */
export function RunActionsBar({
  run,
  onRefresh,
  position,
}: RunActionsBarProps) {
  if (position === "top") {
    return <ControlBar run={run} onRefresh={onRefresh} />;
  }
  return <BottomBar run={run} />;
}
