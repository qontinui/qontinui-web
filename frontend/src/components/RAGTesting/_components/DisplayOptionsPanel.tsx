"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface DisplayOptionsPanelProps {
  showSegmentation: boolean;
  setShowSegmentation: (show: boolean) => void;
  showLabels: boolean;
  setShowLabels: (show: boolean) => void;
  highlightMatches: boolean;
  setHighlightMatches: (highlight: boolean) => void;
}

export function DisplayOptionsPanel({
  showSegmentation,
  setShowSegmentation,
  showLabels,
  setShowLabels,
  highlightMatches,
  setHighlightMatches,
}: DisplayOptionsPanelProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-default">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Display Options</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Show Segmentation</Label>
          <Switch
            checked={showSegmentation}
            onCheckedChange={setShowSegmentation}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Show Labels</Label>
          <Switch checked={showLabels} onCheckedChange={setShowLabels} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Highlight Matches</Label>
          <Switch
            checked={highlightMatches}
            onCheckedChange={setHighlightMatches}
          />
        </div>
      </CardContent>
    </Card>
  );
}
