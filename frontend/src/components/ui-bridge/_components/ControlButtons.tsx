"use client";

/**
 * Start/Stop control buttons and status badge for exploration.
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Square } from "lucide-react";
import type { ExplorationProgress } from "../exploration-config-types";
import { getStatusBadgeClass } from "../exploration-config-utils";

interface ControlButtonsProps {
  isRunning: boolean;
  canStart: boolean;
  disabledReason: string | undefined;
  progressStatus: ExplorationProgress["status"];
  onStart: () => void;
  onStop: () => void;
}

export function ControlButtons({
  isRunning,
  canStart,
  disabledReason,
  progressStatus,
  onStart,
  onStop,
}: ControlButtonsProps) {
  return (
    <div className="flex items-center gap-3">
      {!isRunning ? (
        <Button
          onClick={onStart}
          className="bg-brand-success hover:bg-brand-success/80 text-white"
          disabled={!canStart}
          title={disabledReason}
        >
          <Play className="w-4 h-4 mr-2" />
          Start Exploration
        </Button>
      ) : (
        <Button onClick={onStop} variant="destructive">
          <Square className="w-4 h-4 mr-2" />
          Stop
        </Button>
      )}

      {progressStatus !== "idle" && (
        <div className="flex items-center gap-2 ml-auto">
          <Badge
            variant="outline"
            className={getStatusBadgeClass(progressStatus)}
          >
            {progressStatus.toUpperCase()}
          </Badge>
        </div>
      )}
    </div>
  );
}
