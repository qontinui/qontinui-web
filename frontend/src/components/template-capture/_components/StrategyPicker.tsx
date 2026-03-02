import React from "react";
import { Badge } from "@/components/ui/badge";
import type { DetectionStrategyType } from "@/services/template-capture-service";

const STRATEGY_OPTIONS: DetectionStrategyType[] = [
  "contour",
  "edge",
  "color_segmentation",
  "flood_fill",
  "gradient",
];

interface StrategyPickerProps {
  selected: DetectionStrategyType[];
  onToggle: (strategy: DetectionStrategyType) => void;
}

export function StrategyPicker({ selected, onToggle }: StrategyPickerProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {STRATEGY_OPTIONS.map((strategy) => (
        <Badge
          key={strategy}
          variant={selected.includes(strategy) ? "default" : "outline"}
          className="cursor-pointer"
          onClick={() => onToggle(strategy)}
        >
          {strategy}
        </Badge>
      ))}
    </div>
  );
}
