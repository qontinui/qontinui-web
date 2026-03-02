"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import type { AnalysisOptionsProps } from "../types";

export function AnalysisOptions({
  fuseResults,
  onFuseResultsChange,
  overlapThreshold,
  onOverlapThresholdChange,
  runInParallel,
  onRunInParallelChange,
  saveToDatabase,
  onSaveToDatabaseChange,
}: AnalysisOptionsProps) {
  return (
    <div className="space-y-4">
      <Label className="text-base font-semibold">Analysis Options</Label>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="fuse-results">Fuse Results</Label>
            <p className="text-xs text-muted-foreground">
              Combine regions from multiple analyzers
            </p>
          </div>
          <Switch
            id="fuse-results"
            checked={fuseResults}
            onCheckedChange={onFuseResultsChange}
          />
        </div>

        {fuseResults && (
          <div className="space-y-2 pl-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="overlap-threshold" className="text-sm">
                Overlap Threshold
              </Label>
              <span className="text-sm text-muted-foreground">
                {overlapThreshold}
              </span>
            </div>
            <Slider
              id="overlap-threshold"
              min={0}
              max={1}
              step={0.05}
              value={[overlapThreshold]}
              onValueChange={(value) =>
                onOverlapThresholdChange(value[0] ?? 0.5)
              }
            />
            <p className="text-xs text-muted-foreground">
              IoU threshold for grouping overlapping regions
            </p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="parallel">Run in Parallel</Label>
            <p className="text-xs text-muted-foreground">
              Execute analyzers concurrently
            </p>
          </div>
          <Switch
            id="parallel"
            checked={runInParallel}
            onCheckedChange={onRunInParallelChange}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="save-db">Save to Database</Label>
            <p className="text-xs text-muted-foreground">
              Store results for later review
            </p>
          </div>
          <Switch
            id="save-db"
            checked={saveToDatabase}
            onCheckedChange={onSaveToDatabaseChange}
          />
        </div>
      </div>
    </div>
  );
}
