/**
 * Merged Candidates View Component
 *
 * Displays the final merged StateImage candidates after IoU deduplication.
 * Shows all candidates with their source detection techniques.
 */

"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Download, CheckCircle2 } from "lucide-react";
import { ScreenshotCanvas, BoundingBoxOverlay } from "./ScreenshotCanvas";
import type { ExtractedStateImageCandidate } from "@/types/vision-extraction";

// Category colors
const CATEGORY_COLORS: Record<string, { stroke: string; fill: string }> = {
  button: { stroke: "rgb(34, 197, 94)", fill: "rgba(34, 197, 94, 0.2)" },
  input: { stroke: "rgb(59, 130, 246)", fill: "rgba(59, 130, 246, 0.2)" },
  icon: { stroke: "rgb(234, 179, 8)", fill: "rgba(234, 179, 8, 0.2)" },
  label: { stroke: "rgb(168, 85, 247)", fill: "rgba(168, 85, 247, 0.2)" },
  link: { stroke: "rgb(6, 182, 212)", fill: "rgba(6, 182, 212, 0.2)" },
  container: { stroke: "rgb(156, 163, 175)", fill: "rgba(156, 163, 175, 0.1)" },
  paragraph: { stroke: "rgb(107, 114, 128)", fill: "rgba(107, 114, 128, 0.1)" },
  element: { stroke: "rgb(255, 255, 255)", fill: "rgba(255, 255, 255, 0.1)" },
};

// Technique badge colors
const TECHNIQUE_COLORS: Record<string, string> = {
  edge: "bg-info-muted text-info",
  sam3: "bg-success-muted text-success",
  ocr: "bg-brand-secondary/20 text-brand-secondary",
};

interface MergedCandidatesViewProps {
  /** Base64-encoded screenshot or URL */
  screenshotSource: string;
  /** Merged StateImage candidates */
  candidates: ExtractedStateImageCandidate[];
  /** Screenshot dimensions */
  imageWidth?: number;
  imageHeight?: number;
  /** Callback when candidates are selected for export */
  onExport?: (selectedIds: string[]) => void;
}

export function MergedCandidatesView({
  screenshotSource,
  candidates,
  imageWidth,
  imageHeight,
  onExport,
}: MergedCandidatesViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(
    new Set()
  );
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterTechnique, setFilterTechnique] = useState<string>("all");
  const [showClickableOnly, setShowClickableOnly] = useState(false);

  // Get unique categories and techniques
  const { categories, techniques } = useMemo(() => {
    const cats = new Set<string>();
    const techs = new Set<string>();
    for (const c of candidates) {
      if (c.category) cats.add(c.category);
      techs.add(c.detection_technique);
    }
    return {
      categories: Array.from(cats).sort(),
      techniques: Array.from(techs).sort(),
    };
  }, [candidates]);

  // Filter candidates
  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      if (filterCategory !== "all" && c.category !== filterCategory)
        return false;
      if (
        filterTechnique !== "all" &&
        !c.detection_technique.includes(filterTechnique)
      )
        return false;
      if (showClickableOnly && !c.is_clickable) return false;
      return true;
    });
  }, [candidates, filterCategory, filterTechnique, showClickableOnly]);

  // Group by category
  const categorizedCandidates = useMemo(() => {
    const groups: Record<string, ExtractedStateImageCandidate[]> = {};
    for (const c of filteredCandidates) {
      const category = c.category || "element";
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(c);
    }
    return groups;
  }, [filteredCandidates]);

  const selectedCandidate = candidates.find((c) => c.id === selectedId);

  // Toggle export selection
  const toggleExportSelection = (id: string) => {
    setSelectedForExport((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all visible
  const selectAllVisible = () => {
    setSelectedForExport(new Set(filteredCandidates.map((c) => c.id)));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedForExport(new Set());
  };

  // Handle export
  const handleExport = () => {
    if (onExport && selectedForExport.size > 0) {
      onExport(Array.from(selectedForExport));
    }
  };

  return (
    <div className="flex gap-4 h-full">
      {/* Left: Screenshot with overlays */}
      <div className="flex-1 min-w-0 border rounded-lg overflow-hidden bg-muted/20">
        <ScreenshotCanvas
          imageSource={screenshotSource}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          className="h-full"
        >
          {/* Draw bounding boxes */}
          {filteredCandidates.map((candidate) => {
            const category = candidate.category || "element";
            const colors =
              CATEGORY_COLORS[category] ?? CATEGORY_COLORS.element!;
            const isSelected = selectedId === candidate.id;
            const isExportSelected = selectedForExport.has(candidate.id);

            return (
              <BoundingBoxOverlay
                key={`bbox-${candidate.id}`}
                bbox={candidate.bbox}
                color={isExportSelected ? "rgb(255, 215, 0)" : colors.stroke}
                fillColor={
                  isExportSelected ? "rgba(255, 215, 0, 0.3)" : colors.fill
                }
                strokeWidth={isExportSelected ? 3 : 2}
                label={`${category} (${Math.round(candidate.confidence * 100)}%)`}
                onClick={() =>
                  setSelectedId(
                    candidate.id === selectedId ? null : candidate.id
                  )
                }
                isSelected={isSelected}
              />
            );
          })}
        </ScreenshotCanvas>
      </div>

      {/* Right: Filters and Results */}
      <div className="w-96 shrink-0 flex flex-col gap-4">
        {/* Filters */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">Category</Label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full h-8 rounded border bg-background px-2 text-sm"
              >
                <option value="all">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Detection Technique</Label>
              <select
                value={filterTechnique}
                onChange={(e) => setFilterTechnique(e.target.value)}
                className="w-full h-8 rounded border bg-background px-2 text-sm"
              >
                <option value="all">All Techniques</option>
                {techniques.map((tech) => (
                  <option key={tech} value={tech}>
                    {tech}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="clickableOnly"
                checked={showClickableOnly}
                onChange={(e) => setShowClickableOnly(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="clickableOnly" className="text-sm">
                Clickable elements only
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>StateImage Candidates</span>
              <Badge variant="secondary">
                {filteredCandidates.length}
                {filteredCandidates.length !== candidates.length &&
                  ` / ${candidates.length}`}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex flex-wrap gap-1 px-3 pb-2">
              {Object.entries(categorizedCandidates).map(
                ([category, items]) => (
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
                )
              )}
            </div>
          </CardContent>
        </Card>

        {/* Export Actions */}
        {onExport && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Export Selection</span>
                <Badge variant="outline">
                  {selectedForExport.size} selected
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={selectAllVisible}
                  className="flex-1"
                >
                  Select All
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={clearSelection}
                  className="flex-1"
                >
                  Clear
                </Button>
              </div>
              <Button
                size="sm"
                onClick={handleExport}
                disabled={selectedForExport.size === 0}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Export {selectedForExport.size} Candidates
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Results List */}
        <Card className="flex-1 min-h-0">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Candidates</CardTitle>
          </CardHeader>
          <ScrollArea className="h-[300px]">
            <CardContent className="space-y-2">
              {filteredCandidates.map((candidate) => {
                const category = candidate.category || "element";
                const colors =
                  CATEGORY_COLORS[category] ?? CATEGORY_COLORS.element!;
                const isSelected = selectedId === candidate.id;
                const isExportSelected = selectedForExport.has(candidate.id);
                const techniques = candidate.detection_technique.split("+");

                return (
                  <div
                    key={candidate.id}
                    className={`p-2 rounded-lg border transition-colors ${
                      isSelected
                        ? "border-success bg-success-muted"
                        : isExportSelected
                          ? "border-warning bg-warning-muted"
                          : "hover:bg-accent"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          style={{
                            borderColor: colors.stroke,
                            color: colors.stroke,
                          }}
                        >
                          {category}
                        </Badge>
                        {candidate.is_clickable && (
                          <Badge variant="secondary" className="text-xs">
                            clickable
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {Math.round(candidate.confidence * 100)}%
                        </span>
                        {onExport && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExportSelection(candidate.id);
                            }}
                            className={`p-1 rounded ${
                              isExportSelected
                                ? "text-warning"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Detection techniques */}
                    <div className="flex gap-1 mb-1">
                      {techniques.map((tech, idx) => (
                        <span
                          key={idx}
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            TECHNIQUE_COLORS[tech] ||
                            "bg-muted text-muted-foreground"
                          }`}
                        >
                          {tech}
                        </span>
                      ))}
                    </div>

                    {/* Text content if available */}
                    {candidate.text && (
                      <div className="text-sm text-muted-foreground truncate mb-1">
                        &quot;{candidate.text}&quot;
                      </div>
                    )}

                    <div
                      className="text-xs text-muted-foreground cursor-pointer"
                      onClick={() =>
                        setSelectedId(isSelected ? null : candidate.id)
                      }
                    >
                      {candidate.bbox.width} x {candidate.bbox.height} at (
                      {candidate.bbox.x}, {candidate.bbox.y})
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </ScrollArea>
        </Card>

        {/* Selected Details */}
        {selectedCandidate && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Selected Candidate</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              <div>ID: {selectedCandidate.id}</div>
              <div>Category: {selectedCandidate.category || "unknown"}</div>
              <div>
                Confidence: {(selectedCandidate.confidence * 100).toFixed(1)}%
              </div>
              <div>Technique: {selectedCandidate.detection_technique}</div>
              <div>
                Clickable: {selectedCandidate.is_clickable ? "Yes" : "No"}
              </div>
              {selectedCandidate.text && (
                <div>Text: &quot;{selectedCandidate.text}&quot;</div>
              )}
              <div>
                Position: ({selectedCandidate.bbox.x},{" "}
                {selectedCandidate.bbox.y})
              </div>
              <div>
                Size: {selectedCandidate.bbox.width} x{" "}
                {selectedCandidate.bbox.height}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
