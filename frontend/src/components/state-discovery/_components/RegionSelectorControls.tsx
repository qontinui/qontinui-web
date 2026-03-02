/**
 * Controls toolbar for RegionSelector: Select All, Clear, and region info display
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { Maximize, X } from "lucide-react";
import { Region } from "../region-selector-types";

interface RegionSelectorControlsProps {
  imageUrl: string;
  currentRegion: Region | null;
  onSelectAll: () => void;
  onClear: () => void;
}

const RegionSelectorControls: React.FC<RegionSelectorControlsProps> = ({
  imageUrl,
  currentRegion,
  onSelectAll,
  onClear,
}) => {
  return (
    <div className="flex items-center justify-between">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onSelectAll}
          disabled={!imageUrl}
        >
          <Maximize className="mr-2 h-4 w-4" />
          Select All
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onClear}
          disabled={!currentRegion}
        >
          <X className="mr-2 h-4 w-4" />
          Clear
        </Button>
      </div>
      {currentRegion && (
        <div className="text-sm text-text-muted">
          Region: {Math.round(currentRegion.x)},{Math.round(currentRegion.y)}{" "}
          &bull;{Math.round(currentRegion.width)}&times;
          {Math.round(currentRegion.height)}px
        </div>
      )}
    </div>
  );
};

export default RegionSelectorControls;
