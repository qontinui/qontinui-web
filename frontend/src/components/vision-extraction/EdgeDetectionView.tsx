/**
 * Edge Detection View Component
 *
 * Displays edge detection results with:
 * - Canny edges overlaid on screenshot
 * - Detected contours highlighted
 * - Configuration controls for Canny thresholds
 * - List of detected elements with details
 */

"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ScreenshotCanvas,
  BoundingBoxOverlay,
  ContourOverlay,
} from "./ScreenshotCanvas";
import type {
  EdgeDetectionResult,
  ContourResult,
  EdgeDetectionConfig,
} from "@/types/vision-extraction";

// Color palette for different element categories
const CATEGORY_COLORS: Record<string, { stroke: string; fill: string }> = {
  button: { stroke: "rgb(34, 197, 94)", fill: "rgba(34, 197, 94, 0.2)" },
  input: { stroke: "rgb(59, 130, 246)", fill: "rgba(59, 130, 246, 0.2)" },
  icon: { stroke: "rgb(234, 179, 8)", fill: "rgba(234, 179, 8, 0.2)" },
  container: { stroke: "rgb(156, 163, 175)", fill: "rgba(156, 163, 175, 0.1)" },
  element: { stroke: "rgb(168, 85, 247)", fill: "rgba(168, 85, 247, 0.2)" },
};

interface EdgeDetectionViewProps {
  /** Base64-encoded screenshot or URL */
  screenshotSource: string;
  /** Edge detection results */
  results: EdgeDetectionResult[];
  /** Contour results for debug view */
  contours?: ContourResult[];
  /** Edge overlay image (base64) */
  edgeOverlayImage?: string | null;
  /** Current configuration */
  config?: EdgeDetectionConfig;
  /** Callback when configuration changes (for re-running detection) */
  onConfigChange?: (config: EdgeDetectionConfig) => void;
  /** Screenshot dimensions */
  imageWidth?: number;
  imageHeight?: number;
}

const DEFAULT_CONTOURS: ContourResult[] = [];

export function EdgeDetectionView({
  screenshotSource,
  results,
  contours: _contours = DEFAULT_CONTOURS,
  edgeOverlayImage,
  config,
  onConfigChange,
  imageWidth,
  imageHeight,
}: EdgeDetectionViewProps) {
  // _contours available for future use in debug view
  void _contours;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showEdges, setShowEdges] = useState(true);
  const [showContours, setShowContours] = useState(true);
  const [showBboxes, setShowBboxes] = useState(true);

  // Group results by inferred category
  const categorizedResults = useMemo(() => {
    const categories: Record<string, EdgeDetectionResult[]> = {};
    for (const result of results) {
      const category = classifyEdgeResult(result);
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(result);
    }
    return categories;
  }, [results]);

  const selectedResult = results.find((r) => r.id === selectedId);

  // Use edge overlay if available, otherwise use original screenshot
  const displayImage =
    showEdges && edgeOverlayImage ? edgeOverlayImage : screenshotSource;

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
          {/* Draw contour polygons */}
          {showContours &&
            results.map((result) => {
              if (!result.contour_points) return null;
              const category = classifyEdgeResult(result);
              const colors =
                CATEGORY_COLORS[category] ?? CATEGORY_COLORS.element!;
              return (
                <ContourOverlay
                  key={`contour-${result.id}`}
                  points={result.contour_points}
                  color={
                    selectedId === result.id
                      ? "rgb(34, 197, 94)"
                      : colors.stroke
                  }
                  strokeWidth={selectedId === result.id ? 2 : 1}
                />
              );
            })}

          {/* Draw bounding boxes */}
          {showBboxes &&
            results.map((result) => {
              const category = classifyEdgeResult(result);
              const colors =
                CATEGORY_COLORS[category] ?? CATEGORY_COLORS.element!;
              return (
                <BoundingBoxOverlay
                  key={`bbox-${result.id}`}
                  bbox={result.bbox}
                  color={colors.stroke}
                  fillColor={colors.fill}
                  label={`${category} (${Math.round(result.confidence * 100)}%)`}
                  onClick={() =>
                    setSelectedId(result.id === selectedId ? null : result.id)
                  }
                  isSelected={selectedId === result.id}
                />
              );
            })}
        </ScreenshotCanvas>
      </div>

      {/* Right: Controls and Results List */}
      <div className="w-80 shrink-0 flex flex-col gap-4">
        {/* Controls */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Display Options</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="showEdges"
                checked={showEdges}
                onChange={(e) => setShowEdges(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="showEdges" className="text-sm">
                Show edge overlay
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="showContours"
                checked={showContours}
                onChange={(e) => setShowContours(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="showContours" className="text-sm">
                Show contours
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

        {/* Configuration (if provided) */}
        {config && onConfigChange && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Edge Detection Config</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Canny Low: {config.canny_low}</Label>
                <Slider
                  value={[config.canny_low]}
                  min={0}
                  max={255}
                  step={5}
                  onValueChange={([value]) =>
                    onConfigChange({
                      ...config,
                      canny_low: value ?? config.canny_low,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">
                  Canny High: {config.canny_high}
                </Label>
                <Slider
                  value={[config.canny_high]}
                  min={0}
                  max={255}
                  step={5}
                  onValueChange={([value]) =>
                    onConfigChange({
                      ...config,
                      canny_high: value ?? config.canny_high,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">
                  Min Area: {config.min_contour_area}
                </Label>
                <Slider
                  value={[config.min_contour_area]}
                  min={0}
                  max={5000}
                  step={50}
                  onValueChange={([value]) =>
                    onConfigChange({
                      ...config,
                      min_contour_area: value ?? config.min_contour_area,
                    })
                  }
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results Summary */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Detected Elements</span>
              <Badge variant="secondary">{results.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex flex-wrap gap-1 px-3 pb-2">
              {Object.entries(categorizedResults).map(([category, items]) => (
                <Badge
                  key={category}
                  variant="outline"
                  style={{
                    borderColor:
                      CATEGORY_COLORS[category]?.stroke ??
                      CATEGORY_COLORS.element!.stroke,
                    color:
                      CATEGORY_COLORS[category]?.stroke ??
                      CATEGORY_COLORS.element!.stroke,
                  }}
                >
                  {category}: {items.length}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Results List */}
        <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <CardHeader className="py-3 shrink-0">
            <CardTitle className="text-sm">Results</CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1">
            <CardContent className="space-y-2">
              {results.map((result) => {
                const category = classifyEdgeResult(result);
                const colors =
                  CATEGORY_COLORS[category] ?? CATEGORY_COLORS.element!;
                const isSelected = selectedId === result.id;

                return (
                  <div
                    key={result.id}
                    role="option"
                    tabIndex={0}
                    aria-selected={isSelected}
                    className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? "border-success bg-success-muted"
                        : "hover:bg-accent"
                    }`}
                    onClick={() => setSelectedId(isSelected ? null : result.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(isSelected ? null : result.id);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Badge
                        variant="outline"
                        style={{
                          borderColor: colors.stroke,
                          color: colors.stroke,
                        }}
                      >
                        {category}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(result.confidence * 100)}%
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div>
                        Position: ({result.bbox.x}, {result.bbox.y})
                      </div>
                      <div>
                        Size: {result.bbox.width} x {result.bbox.height}
                      </div>
                      <div>
                        Vertices: {result.vertex_count}, AR:{" "}
                        {result.aspect_ratio.toFixed(2)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </ScrollArea>
        </Card>

        {/* Selected Details */}
        {selectedResult && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Selected Element</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              <div>ID: {selectedResult.id}</div>
              <div>
                Confidence: {Math.round(selectedResult.confidence * 100)}%
              </div>
              <div>Contour Area: {Math.round(selectedResult.contour_area)}</div>
              <div>
                Perimeter: {Math.round(selectedResult.contour_perimeter)}
              </div>
              <div>Vertices: {selectedResult.vertex_count}</div>
              <div>Aspect Ratio: {selectedResult.aspect_ratio.toFixed(3)}</div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * Classify edge detection result into element category.
 * This mirrors the Python classification logic.
 */
function classifyEdgeResult(result: EdgeDetectionResult): string {
  const { bbox, aspect_ratio, vertex_count, contour_area } = result;

  if (vertex_count === 4) {
    if (
      1.5 < aspect_ratio &&
      aspect_ratio < 6.0 &&
      30 < bbox.width &&
      bbox.width < 300 &&
      20 < bbox.height &&
      bbox.height < 60
    ) {
      return "button";
    }
    if (aspect_ratio > 4.0 && bbox.height < 50) {
      return "input";
    }
    if (bbox.width > 200 && bbox.height > 100) {
      return "container";
    }
  }

  if (
    0.8 < aspect_ratio &&
    aspect_ratio < 1.25 &&
    bbox.width < 60 &&
    bbox.height < 60
  ) {
    return "icon";
  }

  if (contour_area > 10000) {
    return "container";
  }

  return "element";
}
