import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Layers,
  SplitSquareVertical,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import type { DiffRegion } from "@/services/testing-service";
import type { ViewMode } from "../types";

interface ControlsBarProps {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  zoom: number;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleResetZoom: () => void;
  similarityScore?: number;
  threshold?: number;
  overlayOpacity: number;
  setOverlayOpacity: (value: number) => void;
  swipePosition: number;
  setSwipePosition: (value: number) => void;
  diffRegions: DiffRegion[];
  showDiffRegions: boolean;
  setShowDiffRegions: (value: boolean) => void;
}

export function ControlsBar({
  mode,
  setMode,
  zoom,
  handleZoomIn,
  handleZoomOut,
  handleResetZoom,
  similarityScore,
  threshold,
  overlayOpacity,
  setOverlayOpacity,
  swipePosition,
  setSwipePosition,
  diffRegions,
  showDiffRegions,
  setShowDiffRegions,
}: ControlsBarProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div
          className="flex items-center gap-1 border rounded-lg p-1"
          data-ui-id="testing-visual-diff-mode-selector"
        >
          <Button
            variant={mode === "side-by-side" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("side-by-side")}
            className="h-8 px-3"
            data-ui-id="testing-visual-diff-sidebyside-btn"
          >
            <SplitSquareVertical className="h-4 w-4 mr-1" />
            Side by Side
          </Button>
          <Button
            variant={mode === "overlay" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("overlay")}
            className="h-8 px-3"
            data-ui-id="testing-visual-diff-overlay-btn"
          >
            <Layers className="h-4 w-4 mr-1" />
            Overlay
          </Button>
          <Button
            variant={mode === "swipe" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("swipe")}
            className="h-8 px-3"
            data-ui-id="testing-visual-diff-swipe-btn"
          >
            <Maximize2 className="h-4 w-4 mr-1" />
            Swipe
          </Button>
          <Button
            variant={mode === "blink" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("blink")}
            className="h-8 px-3"
            data-ui-id="testing-visual-diff-blink-btn"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Blink
          </Button>
        </div>

        {similarityScore !== undefined && (
          <div className="flex items-center gap-2">
            <Badge
              variant={
                similarityScore >= (threshold || 0.95)
                  ? "default"
                  : "destructive"
              }
            >
              {(similarityScore * 100).toFixed(1)}% match
            </Badge>
            {threshold !== undefined && (
              <span className="text-xs text-muted-foreground">
                (threshold: {(threshold * 100).toFixed(0)}%)
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-1 border rounded-lg p-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomOut}
            disabled={zoom <= 0.25}
            className="h-8 w-8 p-0"
            data-ui-id="testing-visual-diff-zoom-out-btn"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs px-2 min-w-[3rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomIn}
            disabled={zoom >= 4}
            className="h-8 w-8 p-0"
            data-ui-id="testing-visual-diff-zoom-in-btn"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetZoom}
            className="h-8 px-2"
            data-ui-id="testing-visual-diff-zoom-reset-btn"
          >
            Reset
          </Button>
        </div>
      </div>

      {mode === "overlay" && (
        <div className="flex items-center gap-4 px-2">
          <span className="text-sm text-muted-foreground">Baseline</span>
          <Slider
            value={[overlayOpacity * 100]}
            onValueChange={([value]) => setOverlayOpacity((value ?? 0) / 100)}
            max={100}
            step={1}
            className="flex-1"
          />
          <span className="text-sm text-muted-foreground">Screenshot</span>
        </div>
      )}

      {mode === "swipe" && (
        <div className="flex items-center gap-4 px-2">
          <span className="text-sm text-muted-foreground">Baseline</span>
          <Slider
            value={[swipePosition]}
            onValueChange={([value]) => setSwipePosition(value ?? 0)}
            max={100}
            step={1}
            className="flex-1"
          />
          <span className="text-sm text-muted-foreground">Screenshot</span>
        </div>
      )}

      {diffRegions.length > 0 && (
        <div className="flex items-center gap-2 px-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={showDiffRegions}
              onChange={(e) => setShowDiffRegions(e.target.checked)}
              className="rounded"
            />
            Show diff regions ({diffRegions.length})
          </label>
        </div>
      )}
    </>
  );
}
