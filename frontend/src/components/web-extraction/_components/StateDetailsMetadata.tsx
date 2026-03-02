"use client";

import type { ViewMode } from "../state-image-modal-types";

interface StateDetailsMetadataProps {
  viewMode: ViewMode;
  stateId: string;
  selectedElementId: string | null;
  viewportWidth: number;
  viewportHeight: number;
}

export function StateDetailsMetadata({
  viewMode,
  stateId,
  selectedElementId,
  viewportWidth,
  viewportHeight,
}: StateDetailsMetadataProps) {
  const displayId =
    viewMode === "element" && selectedElementId ? selectedElementId : stateId;

  return (
    <div className="space-y-1.5 text-xs">
      <h4 className="font-medium">Metadata</h4>
      <div className="flex justify-between">
        <span className="text-muted-foreground">
          {viewMode === "element" ? "Element ID:" : "State ID:"}
        </span>
        <span className="font-mono truncate max-w-[100px]" title={displayId}>
          {displayId.substring(0, 8)}...
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Viewport:</span>
        <span>
          {viewportWidth}&times;{viewportHeight}
        </span>
      </div>
    </div>
  );
}
