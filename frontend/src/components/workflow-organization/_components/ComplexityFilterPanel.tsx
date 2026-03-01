/**
 * ComplexityFilterPanel Component
 *
 * Checkbox list for filtering workflows by complexity level.
 */

import React from "react";
import { BarChart3 } from "lucide-react";
import { Label } from "../../ui/label";
import { Checkbox } from "../../ui/checkbox";
import { ComplexityLevel } from "../types";

export interface ComplexityFilterPanelProps {
  selectedComplexity: ComplexityLevel[];
  setSelectedComplexity: (levels: ComplexityLevel[]) => void;
}

export function ComplexityFilterPanel({
  selectedComplexity,
  setSelectedComplexity,
}: ComplexityFilterPanelProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <Label>Complexity</Label>
      </div>
      <div className="space-y-1">
        {(["low", "medium", "high", "very-high"] as ComplexityLevel[]).map(
          (level) => (
            <div
              key={level}
              className="flex items-center gap-2 py-1 px-2 hover:bg-accent rounded cursor-pointer"
            >
              <Checkbox
                checked={selectedComplexity.includes(level)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setSelectedComplexity([...selectedComplexity, level]);
                  } else {
                    setSelectedComplexity(
                      selectedComplexity.filter((l) => l !== level)
                    );
                  }
                }}
              />
              <span className="text-sm capitalize">
                {level.replace("-", " ")}
              </span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
