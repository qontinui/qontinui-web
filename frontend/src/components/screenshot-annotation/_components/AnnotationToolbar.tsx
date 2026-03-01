"use client";

import React from "react";
import { MousePointer, Square, Eye, Loader2, Check } from "lucide-react";
import { SelectionMode } from "../../../types/Screenshot";
import { Badge } from "@/components/ui/badge";

interface AnnotationToolbarProps {
  screenshotCount: number;
  saveStatus: "idle" | "saving" | "saved";
  selectionMode: SelectionMode;
  showRegionPanel: boolean;
  showLocationPanel: boolean;
  onSelectionModeChange: (mode: SelectionMode) => void;
  onToggleRegionPanel: () => void;
  onToggleLocationPanel: () => void;
}

const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  screenshotCount,
  saveStatus,
  selectionMode,
  showRegionPanel,
  showLocationPanel,
  onSelectionModeChange,
  onToggleRegionPanel,
  onToggleLocationPanel,
}) => {
  return (
    <div className="bg-surface-raised border-b border-border-subtle p-3 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-muted">Annotate Screenshots</span>
        <Badge
          variant="outline"
          className="text-xs border-border-default text-text-muted"
        >
          {screenshotCount} screenshot{screenshotCount !== 1 ? "s" : ""}
        </Badge>
        {saveStatus === "saving" && (
          <div className="flex items-center gap-1 text-xs text-text-muted">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Saving...</span>
          </div>
        )}
        {saveStatus === "saved" && (
          <div className="flex items-center gap-1 text-xs text-brand-success">
            <Check className="w-3 h-3" />
            <span>Saved</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 bg-surface-canvas rounded p-1">
        <button
          className={`px-3 py-2 rounded flex items-center gap-2 text-sm font-medium transition-colors ${
            selectionMode === "view"
              ? "bg-brand-primary text-black"
              : "text-text-muted hover:text-white hover:bg-surface-raised"
          }`}
          onClick={() => onSelectionModeChange("view")}
          title="View mode - Select existing annotations"
        >
          <Eye className="w-4 h-4" />
          View
        </button>
        <button
          className={`px-3 py-2 rounded flex items-center gap-2 text-sm font-medium transition-colors ${
            selectionMode === "region" || showRegionPanel
              ? "bg-emerald-500 text-white"
              : "text-text-muted hover:text-white hover:bg-surface-raised"
          }`}
          onClick={onToggleRegionPanel}
          title="Region mode - Draw rectangular regions"
        >
          <Square className="w-4 h-4" />
          Region
        </button>
        <button
          className={`px-3 py-2 rounded flex items-center gap-2 text-sm font-medium transition-colors ${
            selectionMode === "location" || showLocationPanel
              ? "bg-brand-secondary text-white"
              : "text-text-muted hover:text-white hover:bg-surface-raised"
          }`}
          onClick={onToggleLocationPanel}
          title="Location mode - Place point locations"
        >
          <MousePointer className="w-4 h-4" />
          Location
        </button>
      </div>
    </div>
  );
};

export default AnnotationToolbar;
