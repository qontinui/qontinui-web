"use client";

import React from "react";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";

interface MaskEditorTopControlsProps {
  brushSize: number[];
  onBrushSizeChange: (value: number[]) => void;
  maxBrushSize: number;
  removalTolerance: number[];
  onRemovalToleranceChange: (value: number[]) => void;
}

export const MaskEditorTopControls: React.FC<MaskEditorTopControlsProps> = ({
  brushSize,
  onBrushSizeChange,
  maxBrushSize,
  removalTolerance,
  onRemovalToleranceChange,
}) => {
  return (
    <div className="bg-surface-raised p-2 flex items-center gap-4 shrink-0">
      <span className="text-sm text-text-muted whitespace-nowrap">
        Brush Size:
      </span>
      <Slider
        value={brushSize}
        onValueChange={onBrushSizeChange}
        min={1}
        max={maxBrushSize}
        step={1}
        className="w-48"
      />
      <span className="text-sm text-text-secondary w-8">{brushSize[0]}</span>

      <Separator orientation="vertical" className="h-6 mx-2" />

      <span className="text-sm text-text-muted whitespace-nowrap">
        Removal Tolerance:
      </span>
      <Slider
        value={removalTolerance}
        onValueChange={onRemovalToleranceChange}
        min={0}
        max={50}
        step={1}
        className="w-48"
      />
      <span className="text-sm text-text-secondary w-8">
        {removalTolerance[0]}
      </span>
    </div>
  );
};
