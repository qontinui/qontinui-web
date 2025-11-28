/**
 * Analysis Results Component
 *
 * Displays analysis results with visual overlay of detected elements
 */

"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Eye, EyeOff, Download, Layers, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import type {
  AnalysisResponse,
  FusedElement,
  DetectedElement,
  AnalyzerResult,
} from "@/services/analysis";

interface AnalysisResultsProps {
  results: AnalysisResponse;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export function AnalysisResults({
  results,
  imageUrl,
  imageWidth = 800,
  imageHeight = 600,
}: AnalysisResultsProps) {
  const [selectedView, setSelectedView] = useState<"fused" | "individual">(
    "fused"
  );
  const [selectedAnalyzer, setSelectedAnalyzer] = useState<string | null>(null);
  const [visibleSources, setVisibleSources] = useState<Set<string>>(new Set());
  const [selectedElement, setSelectedElement] = useState<
    FusedElement | DetectedElement | null
  >(null);

  // Toggle source visibility
  const toggleSource = (source: string) => {
    const newVisible = new Set(visibleSources);
    if (newVisible.has(source)) {
      newVisible.delete(source);
    } else {
      newVisible.add(source);
    }
    setVisibleSources(newVisible);
  };

  // Export results as JSON
  const handleExport = () => {
    const dataStr = JSON.stringify(results, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analysis_results_${results.annotation_set_id}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Results exported");
  };

  const getColorForSource = (source: string, index: number): string => {
    const colors = [
      "#ef4444", // red
      "#3b82f6", // blue
      "#10b981", // green
      "#f59e0b", // yellow
      "#8b5cf6", // purple
      "#ec4899", // pink
    ];
    return colors[index % colors.length];
  };

  const elementsToDisplay =
    selectedView === "fused"
      ? results.fused_elements || []
      : selectedAnalyzer
        ? results.analyzer_results.find(
            (r) => r.analyzer_name === selectedAnalyzer
          )?.elements || []
        : [];

  return (
    <div className="space-y-4">
      {/* Stats Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Analysis Summary</CardTitle>
          <CardDescription>
            Results from {results.analyzer_results.length} analyzer(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-2xl font-bold">
                {results.fused_elements?.length || 0}
              </div>
              <div className="text-xs text-muted-foreground">
                Fused Elements
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {results.analyzer_results.reduce(
                  (sum, r) => sum + r.elements.length,
                  0
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Total Detections
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {results.fusion_stats?.avg_confidence.toFixed(2) || "N/A"}
              </div>
              <div className="text-xs text-muted-foreground">
                Avg Confidence
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {results.fusion_stats?.multi_vote_elements || 0}
              </div>
              <div className="text-xs text-muted-foreground">Multi-Vote</div>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={handleExport} variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export JSON
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Visualization and Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Visualization */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Visual Results</CardTitle>
                <CardDescription>
                  {elementsToDisplay.length} element(s) shown
                </CardDescription>
              </div>

              <Select
                value={selectedView}
                onValueChange={(v: "fused" | "individual") =>
                  setSelectedView(v)
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fused">Fused Results</SelectItem>
                  <SelectItem value="individual">Individual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {selectedView === "individual" && (
              <div className="mb-4">
                <Select
                  value={selectedAnalyzer || ""}
                  onValueChange={setSelectedAnalyzer}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select analyzer" />
                  </SelectTrigger>
                  <SelectContent>
                    {results.analyzer_results.map((result) => (
                      <SelectItem
                        key={result.analyzer_name}
                        value={result.analyzer_name}
                      >
                        {result.analyzer_name} ({result.elements.length}{" "}
                        elements)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="relative border rounded-lg overflow-hidden bg-muted">
              {imageUrl ? (
                <div className="relative">
                  <img
                    src={imageUrl}
                    alt="Analysis visualization"
                    className="w-full h-auto"
                  />

                  {/* Overlay detected elements */}
                  <svg
                    className="absolute top-0 left-0 w-full h-full pointer-events-none"
                    viewBox={`0 0 ${imageWidth} ${imageHeight}`}
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {selectedView === "fused" &&
                      (results.fused_elements || []).map((element, index) => {
                        const color = getColorForSource(
                          element.sources[0],
                          index
                        );
                        return (
                          <g key={index}>
                            <rect
                              x={element.bounding_box.x}
                              y={element.bounding_box.y}
                              width={element.bounding_box.width}
                              height={element.bounding_box.height}
                              fill="none"
                              stroke={color}
                              strokeWidth="3"
                              opacity="0.8"
                            />
                            <text
                              x={element.bounding_box.x + 5}
                              y={element.bounding_box.y + 20}
                              fill={color}
                              fontSize="14"
                              fontWeight="bold"
                              style={{
                                textShadow: "0 0 3px black, 0 0 3px black",
                              }}
                            >
                              {element.label || `E${index + 1}`} (
                              {element.votes})
                            </text>
                          </g>
                        );
                      })}

                    {selectedView === "individual" &&
                      selectedAnalyzer &&
                      (
                        results.analyzer_results.find(
                          (r) => r.analyzer_name === selectedAnalyzer
                        )?.elements || []
                      ).map((element, index) => {
                        const color = "#3b82f6";
                        return (
                          <g key={index}>
                            <rect
                              x={element.bounding_box.x}
                              y={element.bounding_box.y}
                              width={element.bounding_box.width}
                              height={element.bounding_box.height}
                              fill="none"
                              stroke={color}
                              strokeWidth="2"
                              opacity="0.7"
                            />
                            <text
                              x={element.bounding_box.x + 5}
                              y={element.bounding_box.y + 18}
                              fill={color}
                              fontSize="12"
                              fontWeight="bold"
                              style={{
                                textShadow: "0 0 3px black, 0 0 3px black",
                              }}
                            >
                              {element.label || `E${index + 1}`}
                            </text>
                          </g>
                        );
                      })}
                  </svg>
                </div>
              ) : (
                <div className="flex items-center justify-center h-96">
                  <div className="text-center text-muted-foreground">
                    <Layers className="mx-auto h-12 w-12 mb-2" />
                    <p>No image to display</p>
                  </div>
                </div>
              )}
            </div>

            {selectedView === "fused" &&
              (results.fused_elements?.length || 0) > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Layers className="h-4 w-4" />
                    <span className="text-sm font-medium">Sources</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(
                      new Set(
                        results.fused_elements?.flatMap((e) => e.sources) || []
                      )
                    ).map((source, index) => (
                      <Badge
                        key={source}
                        variant={
                          visibleSources.has(source) ? "default" : "outline"
                        }
                        className="cursor-pointer"
                        onClick={() => toggleSource(source)}
                        style={{
                          borderColor: getColorForSource(source, index),
                          backgroundColor: visibleSources.has(source)
                            ? getColorForSource(source, index)
                            : "transparent",
                        }}
                      >
                        {visibleSources.has(source) ? (
                          <Eye className="mr-1 h-3 w-3" />
                        ) : (
                          <EyeOff className="mr-1 h-3 w-3" />
                        )}
                        {source}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
          </CardContent>
        </Card>

        {/* Element Details */}
        <Card>
          <CardHeader>
            <CardTitle>Element Details</CardTitle>
            <CardDescription>Click an element to view details</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="list" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="stats">Stats</TabsTrigger>
              </TabsList>

              <TabsContent value="list" className="space-y-2">
                <ScrollArea className="h-96">
                  {elementsToDisplay.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No elements detected
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {elementsToDisplay.map((element, index) => {
                        const isFused = "votes" in element;
                        return (
                          <button
                            key={index}
                            onClick={() => setSelectedElement(element)}
                            className={`w-full text-left p-3 rounded border transition-colors ${
                              selectedElement === element
                                ? "border-primary bg-accent"
                                : "border-border hover:bg-accent"
                            }`}
                          >
                            <div className="flex items-start justify-between mb-1">
                              <div className="font-medium">
                                {element.label || `Element ${index + 1}`}
                              </div>
                              <div className="flex items-center gap-1">
                                {isFused && (
                                  <Badge
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    {(element as FusedElement).votes} votes
                                  </Badge>
                                )}
                                <Badge
                                  variant={
                                    element.confidence > 0.7
                                      ? "default"
                                      : element.confidence > 0.4
                                        ? "secondary"
                                        : "outline"
                                  }
                                  className="text-xs"
                                >
                                  {(element.confidence * 100).toFixed(0)}%
                                </Badge>
                              </div>
                            </div>

                            <div className="text-xs text-muted-foreground">
                              {Math.round(element.bounding_box.width)} ×{" "}
                              {Math.round(element.bounding_box.height)}px
                              {element.element_type &&
                                ` • ${element.element_type}`}
                            </div>

                            {isFused &&
                              (element as FusedElement).sources.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {(element as FusedElement).sources.map(
                                    (source) => (
                                      <Badge
                                        key={source}
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        {source}
                                      </Badge>
                                    )
                                  )}
                                </div>
                              )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="stats" className="space-y-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    Per-Analyzer Results
                  </div>
                  {results.analyzer_results.map((result) => (
                    <div
                      key={result.analyzer_name}
                      className="flex items-center justify-between p-2 border rounded"
                    >
                      <div className="text-sm">{result.analyzer_name}</div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {result.elements.length}
                        </Badge>
                        <Badge variant="outline">
                          {(result.confidence * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    Confidence Distribution
                  </div>
                  {["High (>70%)", "Medium (40-70%)", "Low (<40%)"].map(
                    (range, i) => {
                      const count = elementsToDisplay.filter((e) => {
                        if (i === 0) return e.confidence > 0.7;
                        if (i === 1)
                          return e.confidence >= 0.4 && e.confidence <= 0.7;
                        return e.confidence < 0.4;
                      }).length;
                      return (
                        <div
                          key={range}
                          className="flex items-center justify-between"
                        >
                          <span className="text-sm text-muted-foreground">
                            {range}
                          </span>
                          <Badge variant="outline">{count}</Badge>
                        </div>
                      );
                    }
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Selected Element Details */}
      {selectedElement && (
        <Card>
          <CardHeader>
            <CardTitle>Selected Element</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium">Label</div>
                  <div className="text-sm text-muted-foreground">
                    {selectedElement.label || "N/A"}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium">Type</div>
                  <div className="text-sm text-muted-foreground">
                    {selectedElement.element_type || "N/A"}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium">Confidence</div>
                  <div className="text-sm text-muted-foreground">
                    {(selectedElement.confidence * 100).toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium">Position</div>
                  <div className="text-sm text-muted-foreground">
                    ({Math.round(selectedElement.bounding_box.x)},{" "}
                    {Math.round(selectedElement.bounding_box.y)})
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium">Size</div>
                  <div className="text-sm text-muted-foreground">
                    {Math.round(selectedElement.bounding_box.width)} ×{" "}
                    {Math.round(selectedElement.bounding_box.height)}px
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium">Area</div>
                  <div className="text-sm text-muted-foreground">
                    {Math.round(
                      selectedElement.bounding_box.width *
                        selectedElement.bounding_box.height
                    )}{" "}
                    px²
                  </div>
                </div>
              </div>

              {"votes" in selectedElement && (
                <>
                  <Separator />
                  <div>
                    <div className="text-sm font-medium mb-2">
                      Source Confidences
                    </div>
                    <div className="space-y-1">
                      {Object.entries(
                        (selectedElement as FusedElement).source_confidences
                      ).map(([source, conf]) => (
                        <div
                          key={source}
                          className="flex items-center justify-between"
                        >
                          <span className="text-sm text-muted-foreground">
                            {source}
                          </span>
                          <Badge variant="outline">
                            {(conf * 100).toFixed(0)}%
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {selectedElement.metadata &&
                Object.keys(selectedElement.metadata).length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <div className="text-sm font-medium mb-2">Metadata</div>
                      <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                        {JSON.stringify(selectedElement.metadata, null, 2)}
                      </pre>
                    </div>
                  </>
                )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
