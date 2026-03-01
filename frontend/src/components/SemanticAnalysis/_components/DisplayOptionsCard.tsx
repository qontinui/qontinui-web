"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { DisplayOptionsState } from "../semantic-analysis-types";

interface DisplayOptionsCardProps {
  options: DisplayOptionsState;
}

export function DisplayOptionsCard({ options }: DisplayOptionsCardProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-default">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Display Options</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Show Labels</Label>
          <Switch
            checked={options.showLabels}
            onCheckedChange={options.setShowLabels}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Show Bounding Boxes</Label>
          <Switch
            checked={options.showBoundingBoxes}
            onCheckedChange={options.setShowBoundingBoxes}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Show Masks</Label>
          <Switch
            checked={options.showMasks}
            onCheckedChange={options.setShowMasks}
          />
        </div>
      </CardContent>
    </Card>
  );
}
