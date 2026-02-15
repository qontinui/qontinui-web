"use client";

import { WifiOff } from "lucide-react";

interface RunnerPartialStateProps {
  message?: string;
}

/**
 * Non-blocking banner shown when the runner is offline but the page
 * still has data from the backend. Unlike RunnerOfflineState, this
 * doesn't replace the page content — it's a soft informational banner.
 */
export function RunnerPartialState({
  message = "Runner offline — showing historical data only. Live run data is unavailable.",
}: RunnerPartialStateProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-sm">
      <WifiOff className="size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
