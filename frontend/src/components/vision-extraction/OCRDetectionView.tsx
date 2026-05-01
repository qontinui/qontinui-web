/**
 * OCR Detection View Component
 *
 * Displays OCR text detection results with:
 * - Text boxes overlaid on screenshot
 * - Detected text content
 * - Confidence scores
 */

"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScreenshotCanvas, BoundingBoxOverlay } from "./ScreenshotCanvas";
import type { OCRResult, OCRConfig } from "@/types/vision-extraction";

// Category colors for OCR results
const CATEGORY_COLORS: Record<string, { stroke: string; fill: string }> = {
  button: { stroke: "rgb(34, 197, 94)", fill: "rgba(34, 197, 94, 0.2)" },
  link: { stroke: "rgb(59, 130, 246)", fill: "rgba(59, 130, 246, 0.2)" },
  label: { stroke: "rgb(168, 85, 247)", fill: "rgba(168, 85, 247, 0.2)" },
  paragraph: { stroke: "rgb(156, 163, 175)", fill: "rgba(156, 163, 175, 0.1)" },
};

interface OCRDetectionViewProps {
  /** Base64-encoded screenshot or URL */
  screenshotSource: string;
  /** OCR detection results */
  results: OCRResult[];
  /** OCR overlay image (base64) */
  ocrOverlayImage?: string | null;
  /** Current configuration */
  config?: OCRConfig;
  /** Screenshot dimensions */
  imageWidth?: number;
  imageHeight?: number;
}

export function OCRDetectionView({
  screenshotSource,
  results,
  ocrOverlayImage,
  config,
  imageWidth,
  imageHeight,
}: OCRDetectionViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showBboxes, setShowBboxes] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [minConfidence, setMinConfidence] = useState(0);

  // Filter results based on search and confidence
  const filteredResults = useMemo(() => {
    return results.filter((r) => {
      if (r.confidence < minConfidence / 100) return false;
      if (
        searchText &&
        !r.text.toLowerCase().includes(searchText.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [results, searchText, minConfidence]);

  // Group by category
  const categorizedResults = useMemo(() => {
    const categories: Record<string, OCRResult[]> = {};
    for (const result of filteredResults) {
      const category = classifyOCRResult(result);
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(result);
    }
    return categories;
  }, [filteredResults]);

  const selectedResult = results.find((r) => r.id === selectedId);

  // Use OCR overlay if available
  const displayImage =
    showOverlay && ocrOverlayImage ? ocrOverlayImage : screenshotSource;

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
          {/* Draw bounding boxes for filtered results */}
          {showBboxes &&
            filteredResults.map((result) => {
              const category = classifyOCRResult(result);
              const colors =
                CATEGORY_COLORS[category] ?? CATEGORY_COLORS.label!;

              // Color based on confidence if not using overlay
              const confColor = getConfidenceColor(result.confidence);

              return (
                <BoundingBoxOverlay
                  key={`bbox-${result.id}`}
                  bbox={result.bbox}
                  color={showOverlay ? colors.stroke : confColor}
                  fillColor={showOverlay ? colors.fill : `${confColor}20`}
                  label={truncateText(result.text, 20)}
                  labelPosition="top"
                  onClick={() =>
                    setSelectedId(result.id === selectedId ? null : result.id)
                  }
                  isSelected={selectedId === result.id}
                />
              );
            })}
        </ScreenshotCanvas>
      </div>

      {/* Right: Controls and Results */}
      <div className="w-96 shrink-0 flex flex-col gap-4">
        {/* Display Options */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Display & Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="showOverlay"
                checked={showOverlay}
                onChange={(e) => setShowOverlay(e.target.checked)}
                className="rounded"
                disabled={!ocrOverlayImage}
              />
              <Label htmlFor="showOverlay" className="text-sm">
                Show OCR overlay
                {!ocrOverlayImage && " (not available)"}
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
                Show text boxes
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="searchText" className="text-sm">
                Search text
              </Label>
              <Input
                id="searchText"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Filter by text..."
                className="h-8"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">
                Min confidence: {minConfidence}%
              </Label>
              <input
                type="range"
                min={0}
                max={100}
                value={minConfidence}
                onChange={(e) => setMinConfidence(parseInt(e.target.value))}
                className="w-full"
              />
            </div>
          </CardContent>
        </Card>

        {/* Configuration Info */}
        {config && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">OCR Configuration</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1 text-muted-foreground">
              <div>Engine: {config.engine}</div>
              <div>Languages: {config.languages.join(", ")}</div>
              <div>Confidence threshold: {config.confidence_threshold}</div>
            </CardContent>
          </Card>
        )}

        {/* Results Summary */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Text Regions</span>
              <Badge variant="secondary">
                {filteredResults.length}
                {filteredResults.length !== results.length &&
                  ` / ${results.length}`}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex flex-wrap gap-1 px-3 pb-2">
              {Object.entries(categorizedResults).map(([category, items]) => (
                <Badge
                  key={category}
                  variant="outline"
                  style={{
                    borderColor: CATEGORY_COLORS[category]?.stroke,
                    color: CATEGORY_COLORS[category]?.stroke,
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
            <CardTitle className="text-sm">Detected Text</CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1">
            <CardContent className="space-y-2">
              {filteredResults.map((result) => {
                const category = classifyOCRResult(result);
                const colors =
                  CATEGORY_COLORS[category] ?? CATEGORY_COLORS.label!;
                const isSelected = selectedId === result.id;

                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={result.id}
                    className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? "border-success bg-success-muted"
                        : "hover:bg-accent"
                    }`}
                    onClick={() => setSelectedId(isSelected ? null : result.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).click();
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
                    <div className="text-sm font-medium mb-1 break-words">
                      &quot;{result.text}&quot;
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {result.bbox.width} x {result.bbox.height} at (
                      {result.bbox.x}, {result.bbox.y})
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
              <CardTitle className="text-sm">Selected Text</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="p-2 bg-muted rounded text-sm break-words">
                {selectedResult.text}
              </div>
              <div className="text-xs space-y-1 text-muted-foreground">
                <div>ID: {selectedResult.id}</div>
                <div>
                  Confidence: {(selectedResult.confidence * 100).toFixed(1)}%
                </div>
                <div>Language: {selectedResult.language}</div>
                <div>
                  Position: ({selectedResult.bbox.x}, {selectedResult.bbox.y})
                </div>
                <div>
                  Size: {selectedResult.bbox.width} x{" "}
                  {selectedResult.bbox.height}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * Classify OCR result into element category.
 */
function classifyOCRResult(result: OCRResult): string {
  const text = result.text.toLowerCase().trim();
  const { bbox } = result;

  const buttonKeywords = [
    "submit",
    "cancel",
    "ok",
    "yes",
    "no",
    "save",
    "delete",
    "add",
    "remove",
    "edit",
    "update",
    "create",
    "close",
    "next",
    "back",
    "previous",
    "continue",
    "done",
    "finish",
    "login",
    "logout",
    "sign in",
    "sign out",
    "sign up",
    "search",
    "filter",
    "sort",
    "reset",
    "clear",
  ];

  if (buttonKeywords.some((kw) => text.includes(kw))) {
    return "button";
  }

  if (
    text.startsWith("http") ||
    text.includes("click") ||
    text.includes("learn more")
  ) {
    return "link";
  }

  if (
    text.length < 15 &&
    1.5 < bbox.width / Math.max(bbox.height, 1) &&
    bbox.width / Math.max(bbox.height, 1) < 6
  ) {
    return "button";
  }

  if (text.length > 50) {
    return "paragraph";
  }

  return "label";
}

/**
 * Get color based on confidence score (red to green).
 */
function getConfidenceColor(confidence: number): string {
  const green = Math.round(confidence * 255);
  const red = Math.round((1 - confidence) * 255);
  return `rgb(${red}, ${green}, 0)`;
}

/**
 * Truncate text to specified length.
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}
