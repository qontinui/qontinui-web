/**
 * SAM3 Segmentation View Component
 *
 * Displays SAM3 segmentation results with:
 * - Colored segment masks overlaid on screenshot
 * - Bounding boxes for each segment
 * - List of segments with stability scores and IoU
 */

"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { ScreenshotCanvas, BoundingBoxOverlay } from "./ScreenshotCanvas";
import type { SAM3SegmentResult, SAM3Config } from "@/types/vision-extraction";

// Color palette for segments
const SEGMENT_COLORS = [
  { stroke: "rgb(59, 130, 246)", fill: "rgba(59, 130, 246, 0.3)" },
  { stroke: "rgb(34, 197, 94)", fill: "rgba(34, 197, 94, 0.3)" },
  { stroke: "rgb(239, 68, 68)", fill: "rgba(239, 68, 68, 0.3)" },
  { stroke: "rgb(234, 179, 8)", fill: "rgba(234, 179, 8, 0.3)" },
  { stroke: "rgb(168, 85, 247)", fill: "rgba(168, 85, 247, 0.3)" },
  { stroke: "rgb(6, 182, 212)", fill: "rgba(6, 182, 212, 0.3)" },
  { stroke: "rgb(249, 115, 22)", fill: "rgba(249, 115, 22, 0.3)" },
  { stroke: "rgb(236, 72, 153)", fill: "rgba(236, 72, 153, 0.3)" },
];

interface SAM3SegmentationViewProps {
  /** Base64-encoded screenshot or URL */
  screenshotSource: string;
  /** SAM3 segmentation results */
  segments: SAM3SegmentResult[];
  /** SAM3 mask overlay image (base64) */
  maskOverlayImage?: string | null;
  /** Current configuration */
  config?: SAM3Config;
  /** Screenshot dimensions */
  imageWidth?: number;
  imageHeight?: number;
}

export function SAM3SegmentationView({
  screenshotSource,
  segments,
  maskOverlayImage,
  config,
  imageWidth,
  imageHeight,
}: SAM3SegmentationViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMasks, setShowMasks] = useState(true);
  const [showBboxes, setShowBboxes] = useState(true);

  // Sort segments by area (largest first)
  const sortedSegments = useMemo(() => {
    return [...segments].sort((a, b) => b.mask_area - a.mask_area);
  }, [segments]);

  const selectedSegment = segments.find((s) => s.id === selectedId);

  // Group by category
  const categorizedSegments = useMemo(() => {
    const categories: Record<string, SAM3SegmentResult[]> = {};
    for (const segment of sortedSegments) {
      const category = classifySAMSegment(segment);
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(segment);
    }
    return categories;
  }, [sortedSegments]);

  // Use mask overlay if available
  const displayImage =
    showMasks && maskOverlayImage ? maskOverlayImage : screenshotSource;

  return (
    <div className="flex gap-4 h-full">
      {/* Left: Screenshot with overlays */}
      <div className="flex-1 min-w-0 border rounded-lg overflow-hidden bg-muted/20">
        <ScreenshotCanvas
          imageSource={displayImage}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          className="h-full"
        >
          {/* Draw bounding boxes */}
          {showBboxes &&
            sortedSegments.map((segment, idx) => {
              const colorIdx = idx % SEGMENT_COLORS.length;
              const colors = SEGMENT_COLORS[colorIdx];
              const category = classifySAMSegment(segment);
              return (
                <BoundingBoxOverlay
                  key={`bbox-${segment.id}`}
                  bbox={segment.bbox}
                  color={colors!.stroke}
                  fillColor={showMasks ? "transparent" : colors!.fill}
                  label={`${category} (${Math.round(segment.stability_score * 100)}%)`}
                  onClick={() =>
                    setSelectedId(segment.id === selectedId ? null : segment.id)
                  }
                  isSelected={selectedId === segment.id}
                />
              );
            })}
        </ScreenshotCanvas>
      </div>

      {/* Right: Controls and Results */}
      <div className="w-80 shrink-0 flex flex-col gap-4">
        {/* Display Options */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Display Options</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="showMasks"
                checked={showMasks}
                onChange={(e) => setShowMasks(e.target.checked)}
                className="rounded"
                disabled={!maskOverlayImage}
              />
              <Label htmlFor="showMasks" className="text-sm">
                Show mask overlay
                {!maskOverlayImage && " (not available)"}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="showBboxes"
                checked={showBboxes}
                onChange={(e) => setShowBboxes(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="showBboxes" className="text-sm">
                Show bounding boxes
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Configuration Info */}
        {config && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">SAM3 Configuration</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1 text-muted-foreground">
              <div>Model: {config.model_type}</div>
              <div>Points per side: {config.points_per_side}</div>
              <div>IoU threshold: {config.pred_iou_thresh}</div>
              <div>Stability threshold: {config.stability_score_thresh}</div>
            </CardContent>
          </Card>
        )}

        {/* Results Summary */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Segments</span>
              <Badge variant="secondary">{segments.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex flex-wrap gap-1 px-3 pb-2">
              {Object.entries(categorizedSegments).map(([category, items]) => (
                <Badge key={category} variant="outline">
                  {category}: {items.length}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Results List */}
        <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <CardHeader className="py-3 shrink-0">
            <CardTitle className="text-sm">Segment List</CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1">
            <CardContent className="space-y-2">
              {sortedSegments.map((segment, idx) => {
                const colorIdx = idx % SEGMENT_COLORS.length;
                const colors = SEGMENT_COLORS[colorIdx];
                const category = classifySAMSegment(segment);
                const isSelected = selectedId === segment.id;

                return (
                  <div
                    key={segment.id}
                    className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? "border-success bg-success-muted"
                        : "hover:bg-accent"
                    }`}
                    onClick={() =>
                      setSelectedId(isSelected ? null : segment.id)
                    }
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: colors!.stroke }}
                        />
                        <Badge variant="outline">{category}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(segment.stability_score * 100)}%
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div>
                        Size: {segment.bbox.width} x {segment.bbox.height}
                      </div>
                      <div>Area: {segment.mask_area.toLocaleString()} px</div>
                      <div>IoU: {segment.predicted_iou.toFixed(3)}</div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </ScrollArea>
        </Card>

        {/* Selected Details */}
        {selectedSegment && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Selected Segment</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              <div>ID: {selectedSegment.id}</div>
              <div>
                Stability Score:{" "}
                {(selectedSegment.stability_score * 100).toFixed(1)}%
              </div>
              <div>
                Predicted IoU: {selectedSegment.predicted_iou.toFixed(3)}
              </div>
              <div>
                Mask Area: {selectedSegment.mask_area.toLocaleString()} px
              </div>
              <div>
                Bounding Box: ({selectedSegment.bbox.x},{" "}
                {selectedSegment.bbox.y}) -{selectedSegment.bbox.width} x{" "}
                {selectedSegment.bbox.height}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * Classify SAM segment into element category.
 */
function classifySAMSegment(segment: SAM3SegmentResult): string {
  const { bbox, mask_area } = segment;
  const aspect_ratio = bbox.width / Math.max(bbox.height, 1);

  if (mask_area < 2500 && 0.7 < aspect_ratio && aspect_ratio < 1.4) {
    return "icon";
  }

  if (
    1.5 < aspect_ratio &&
    aspect_ratio < 6.0 &&
    500 < mask_area &&
    mask_area < 15000
  ) {
    return "button";
  }

  if (aspect_ratio > 4.0 && bbox.height < 50) {
    return "input";
  }

  if (mask_area > 50000) {
    return "container";
  }

  return "element";
}
