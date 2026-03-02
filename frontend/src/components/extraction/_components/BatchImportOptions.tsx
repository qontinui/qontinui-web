"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface BatchImportOptionsProps {
  skipDuplicates: boolean;
  onSkipDuplicatesChange: (value: boolean) => void;
  mergeOverlapping: boolean;
  onMergeOverlappingChange: (value: boolean) => void;
  disabled: boolean;
}

export function BatchImportOptions({
  skipDuplicates,
  onSkipDuplicatesChange,
  mergeOverlapping,
  onMergeOverlappingChange,
  disabled,
}: BatchImportOptionsProps) {
  return (
    <div className="space-y-3 p-3 rounded-lg bg-surface-canvas border border-border-subtle">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm">Skip Duplicates</Label>
          <p className="text-xs text-muted-foreground">
            Skip elements with same label and position
          </p>
        </div>
        <Switch
          checked={skipDuplicates}
          onCheckedChange={onSkipDuplicatesChange}
          disabled={disabled}
        />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm">Merge Overlapping</Label>
          <p className="text-xs text-muted-foreground">
            Combine elements with significant overlap
          </p>
        </div>
        <Switch
          checked={mergeOverlapping}
          onCheckedChange={onMergeOverlappingChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
