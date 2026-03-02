import React from "react";
import { Region } from "@/types/pattern-optimization";
import type { CompositeBounds } from "../types";

interface InfoOverlayProps {
  screenshotCount: number;
  compositeBounds: CompositeBounds | null;
  zoom: number;
  currentRegion: Region | null;
}

export const InfoOverlay: React.FC<InfoOverlayProps> = ({
  screenshotCount,
  compositeBounds,
  zoom,
  currentRegion,
}) => (
  <div className="absolute bottom-4 left-4 bg-surface-raised/80 rounded-lg px-3 py-2 text-xs text-text-secondary">
    <div>Monitors: {screenshotCount}</div>
    {compositeBounds && (
      <div>
        Composite: {compositeBounds.width} × {compositeBounds.height}px
      </div>
    )}
    <div data-zoom-value={zoom}>Zoom: {Math.round(zoom * 100)}%</div>
    {currentRegion && currentRegion.width > 0 && (
      <div className="text-brand-primary">
        Region: {Math.round(currentRegion.width)} ×{" "}
        {Math.round(currentRegion.height)}px
      </div>
    )}
  </div>
);
