"use client";

import { Tag, Percent, CheckCircle2, CheckCheck, Grid3x3 } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";

export function ViewToggles() {
  const {
    showLabels,
    setShowLabels,
    showConfidence,
    setShowConfidence,
    showOnlyGroundTruth,
    setShowOnlyGroundTruth,
    showReviewStatus,
    setShowReviewStatus,
    grid,
    setGridEnabled,
  } = useExtractionAnnotationStore();

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={showLabels}
            onPressedChange={setShowLabels}
            className={showLabels ? "bg-[#9B59B6]/20 text-[#9B59B6]" : ""}
          >
            <Tag className="h-4 w-4" />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Show Labels</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={showConfidence}
            onPressedChange={setShowConfidence}
            className={showConfidence ? "bg-[#9B59B6]/20 text-[#9B59B6]" : ""}
          >
            <Percent className="h-4 w-4" />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Show Confidence</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={showOnlyGroundTruth}
            onPressedChange={setShowOnlyGroundTruth}
            className={
              showOnlyGroundTruth ? "bg-[#9B59B6]/20 text-[#9B59B6]" : ""
            }
          >
            <CheckCircle2 className="h-4 w-4" />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Ground Truth Only</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={showReviewStatus}
            onPressedChange={setShowReviewStatus}
            className={showReviewStatus ? "bg-[#9B59B6]/20 text-[#9B59B6]" : ""}
          >
            <CheckCheck className="h-4 w-4" />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Show Review Status</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={grid.enabled}
            onPressedChange={setGridEnabled}
            className={grid.enabled ? "bg-[#9B59B6]/20 text-[#9B59B6]" : ""}
          >
            <Grid3x3 className="h-4 w-4" />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Snap to Grid (Ctrl+G)</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
