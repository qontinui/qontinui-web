"use client";

import { Loader2, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface VisionAnalysisTabProps {
  selectedMonitor: number;
  setSelectedMonitor: (monitor: number) => void;
  isAnalyzing: boolean;
  onRun: () => void;
}

export function VisionAnalysisTab({
  selectedMonitor,
  setSelectedMonitor,
  isAnalyzing,
  onRun,
}: VisionAnalysisTabProps) {
  return (
    <div className="space-y-3">
      {/* Monitor selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted whitespace-nowrap">
          Monitor:
        </span>
        <Input
          type="number"
          min={0}
          max={10}
          value={selectedMonitor}
          onChange={(e) =>
            setSelectedMonitor(parseInt(e.target.value, 10) || 0)
          }
          className="w-20 h-8 text-xs"
        />
        <span className="text-xs text-text-muted">(0 = primary monitor)</span>
      </div>

      <p className="text-xs text-text-muted">
        Captures a screenshot of the selected monitor and runs vision-based
        element detection (OCR + UI segmentation) via the runner.
      </p>

      <Button
        onClick={onRun}
        disabled={isAnalyzing}
        className="w-full gap-2"
        variant="brand-success"
        size="sm"
      >
        {isAnalyzing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Camera className="size-3.5" />
        )}
        {isAnalyzing ? "Capturing & Analyzing..." : "Capture & Analyze"}
      </Button>
    </div>
  );
}
