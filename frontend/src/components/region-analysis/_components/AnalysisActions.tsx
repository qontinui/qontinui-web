"use client";

import { Button } from "@/components/ui/button";
import { Play, Loader2, Zap } from "lucide-react";
import type { AnalysisActionsProps } from "../types";

export function AnalysisActions({
  isRunning,
  selectedCount,
  onRunAnalysis,
  onQuickAnalysis,
}: AnalysisActionsProps) {
  return (
    <div className="space-y-2">
      <Button
        onClick={onRunAnalysis}
        disabled={isRunning || selectedCount === 0}
        className="w-full"
        size="lg"
      >
        {isRunning ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Running Region Analysis...
          </>
        ) : (
          <>
            <Play className="mr-2 h-5 w-5" />
            Run Full Analysis
          </>
        )}
      </Button>

      <Button
        onClick={onQuickAnalysis}
        disabled={isRunning || selectedCount === 0}
        variant="outline"
        className="w-full"
      >
        {isRunning ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Running...
          </>
        ) : (
          <>
            <Zap className="mr-2 h-4 w-4" />
            Quick Test (No DB)
          </>
        )}
      </Button>

      {selectedCount > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {selectedCount} analyzer{selectedCount > 1 ? "s" : ""} selected
        </p>
      )}
    </div>
  );
}
