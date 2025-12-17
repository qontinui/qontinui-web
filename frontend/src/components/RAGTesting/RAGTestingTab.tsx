"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Target,
  Search,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Filter,
  Layers,
  X,
  ChevronRight,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ScreenshotPicker,
  ScreenshotInfo,
} from "@/components/common/ScreenshotPicker";
import { useAutomation } from "@/contexts/automation-context";
import type {
  RAGFindRequest,
  RAGFindResponse,
  RAGFindMatch,
  SegmentWithMatches,
  SearchMode,
  MatchingStrategy,
} from "@/types/rag-testing";
import type { RAGElement } from "@/types/rag-builder";

// Qontinui API base URL
const QONTINUI_API_URL =
  process.env.NEXT_PUBLIC_QONTINUI_API_URL || "http://localhost:8001";

// Score color based on confidence
function getScoreColor(score: number): string {
  if (score >= 0.8) return "#00FF88"; // Green - high confidence
  if (score >= 0.6) return "#FFD700"; // Yellow - medium confidence
  if (score >= 0.4) return "#FF6B6B"; // Red - low confidence
  return "#808080"; // Gray - very low/no match
}

// Format score as percentage
function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return "N/A";
  return `${(score * 100).toFixed(1)}%`;
}

export function RAGTestingTab() {
  // Screenshot state
  const [currentScreenshot, setCurrentScreenshot] =
    useState<ScreenshotInfo | null>(null);

  // Analysis results
  const [segments, setSegments] = useState<SegmentWithMatches[]>([]);
  const [allMatches, setAllMatches] = useState<RAGFindMatch[]>([]);
  const [processingTime, setProcessingTime] = useState(0);

  // Selection state
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null
  );
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);

  // Search configuration
  const [searchMode, setSearchMode] = useState<SearchMode>("filtered");
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [matchingStrategy, setMatchingStrategy] =
    useState<MatchingStrategy>("average");
  const [similarityThreshold, setSimilarityThreshold] = useState(0.7);
  const [useOCR, setUseOCR] = useState(false);

  // Display options
  const [showSegmentation, setShowSegmentation] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [highlightMatches, setHighlightMatches] = useState(true);

  // Canvas state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // UI state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [ragElements, setRagElements] = useState<RAGElement[]>([]);
  const [loadingElements, setLoadingElements] = useState(false);
  const [elementSelectorOpen, setElementSelectorOpen] = useState(false);

  // Preloaded mask images for rendering
  const [maskImages, setMaskImages] = useState<Map<string, HTMLImageElement>>(
    new Map()
  );

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Context
  const { screenshots, projectId } = useAutomation();

  // Get selected segment
  const selectedSegment = useMemo(() => {
    return segments.find((s) => s.id === selectedSegmentId);
  }, [segments, selectedSegmentId]);

  // Segmentation-only mode (no RAG elements available for matching)
  const isSegmentationOnly = ragElements.length === 0 && !loadingElements;

  // Screenshot handlers for ScreenshotPicker
  const handleUploadScreenshot = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setCurrentScreenshot({
      id: `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      url,
    });
    // Reset results when new screenshot is loaded
    setSegments([]);
    setAllMatches([]);
    setSelectedSegmentId(null);
  }, []);

  const handleSelectProjectScreenshot = useCallback(
    (screenshotId: string) => {
      const projectScreenshot = screenshots.find((s) => s.id === screenshotId);
      if (projectScreenshot && projectScreenshot.url) {
        setCurrentScreenshot({
          id: `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: projectScreenshot.name,
          url: projectScreenshot.url,
        });
        // Reset results when new screenshot is loaded
        setSegments([]);
        setAllMatches([]);
        setSelectedSegmentId(null);
      } else {
        toast.error("Selected screenshot has no image URL");
      }
    },
    [screenshots]
  );

  const handleClearScreenshot = useCallback(() => {
    setCurrentScreenshot(null);
    setSegments([]);
    setAllMatches([]);
    setSelectedSegmentId(null);
    setMaskImages(new Map());
  }, []);

  // Load RAG elements when project changes (optional - segmentation works without them)
  useEffect(() => {
    async function loadElements() {
      if (!projectId) {
        setRagElements([]);
        return;
      }

      setLoadingElements(true);
      try {
        const response = await fetch(
          `${QONTINUI_API_URL}/api/rag/projects/${projectId}/elements`
        );
        if (!response.ok) {
          // 404 is expected when no RAG config exists - not an error, just no elements
          if (response.status === 404) {
            setRagElements([]);
            return;
          }
          throw new Error(`Failed to fetch elements: ${response.statusText}`);
        }
        const elements = await response.json();
        setRagElements(elements);
      } catch (err) {
        // Network errors or other issues - just set empty array and continue
        console.warn(
          "RAG elements not available (segmentation-only mode):",
          err
        );
        setRagElements([]);
      } finally {
        setLoadingElements(false);
      }
    }

    loadElements();
  }, [projectId]);

  // Preload mask images when segments change
  useEffect(() => {
    const loadMasks = async () => {
      const newMaskImages = new Map<string, HTMLImageElement>();

      for (const segment of segments) {
        if (segment.mask_data) {
          try {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () =>
                reject(new Error(`Failed to load mask for ${segment.id}`));
              img.src = segment.mask_data!;
            });
            newMaskImages.set(segment.id, img);
          } catch (err) {
            console.warn(`Failed to load mask for segment ${segment.id}:`, err);
          }
        }
      }

      setMaskImages(newMaskImages);
    };

    if (segments.length > 0) {
      loadMasks();
    }
  }, [segments]);

  // Draw canvas
  useEffect(() => {
    if (!canvasRef.current || !currentScreenshot?.url) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      // Set canvas size
      canvas.width = img.width;
      canvas.height = img.height;

      // Clear and draw image
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      // Draw segments with pixel masks
      segments.forEach((segment) => {
        const isHovered = hoveredSegmentId === segment.id;
        const isSelected = selectedSegmentId === segment.id;
        const hasMatch = segment.bestMatch !== null;
        const score = segment.bestMatch?.score ?? 0;

        // Determine color based on match score
        let color = "#808080"; // Gray for no match
        if (hasMatch && highlightMatches) {
          color = getScoreColor(score);
        }

        const { bbox } = segment;

        // Draw pixel mask (SAM3 segmentation)
        if (showSegmentation) {
          const maskImg = maskImages.get(segment.id);
          if (maskImg) {
            // Create a temporary canvas for colorizing the mask
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = maskImg.width;
            tempCanvas.height = maskImg.height;
            const tempCtx = tempCanvas.getContext("2d");

            if (tempCtx) {
              // Draw the grayscale mask
              tempCtx.drawImage(maskImg, 0, 0);

              // Get mask image data
              const maskData = tempCtx.getImageData(
                0,
                0,
                maskImg.width,
                maskImg.height
              );
              const data = maskData.data;

              // Convert hex color to RGB
              const hexToRgb = (hex: string) => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(
                  hex
                );
                return result && result[1] && result[2] && result[3]
                  ? {
                      r: parseInt(result[1], 16),
                      g: parseInt(result[2], 16),
                      b: parseInt(result[3], 16),
                    }
                  : { r: 128, g: 128, b: 128 };
              };

              const rgb = hexToRgb(color);
              const alpha = isSelected ? 0.6 : isHovered ? 0.5 : 0.35;

              // Colorize the mask - for each pixel, if it's white (part of segment), apply color
              for (let i = 0; i < data.length; i += 4) {
                const brightness = data[i] ?? 0; // Grayscale value (0-255)
                if (brightness > 127) {
                  // This pixel is part of the segment
                  data[i] = rgb.r;
                  data[i + 1] = rgb.g;
                  data[i + 2] = rgb.b;
                  data[i + 3] = Math.floor(alpha * 255);
                } else {
                  // Transparent
                  data[i + 3] = 0;
                }
              }

              tempCtx.putImageData(maskData, 0, 0);

              // Draw the colorized mask onto main canvas at the bbox position
              ctx.drawImage(
                tempCanvas,
                bbox.x,
                bbox.y,
                bbox.width,
                bbox.height
              );

              // Draw outline for selected/hovered segments
              if (isSelected || isHovered) {
                ctx.strokeStyle = color;
                ctx.lineWidth = isSelected ? 3 : 2;
                if (isSelected) {
                  ctx.shadowColor = color;
                  ctx.shadowBlur = 10;
                }
                ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
                ctx.shadowBlur = 0;
              }
            }
          } else {
            // Fallback: draw bounding box if mask not available
            ctx.strokeStyle = color;
            ctx.lineWidth = isSelected ? 3 : isHovered ? 2 : 1;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
            ctx.setLineDash([]);
          }
        }

        // Draw label
        if (showLabels && (isSelected || isHovered) && segment.bestMatch) {
          const label = segment.bestMatch.element_name;
          const scoreText = formatScore(segment.bestMatch.score);

          ctx.font = "12px Inter, sans-serif";
          const textWidth = ctx.measureText(`${label} (${scoreText})`).width;

          // Background
          ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
          ctx.fillRect(bbox.x, bbox.y - 22, textWidth + 12, 20);

          // Text
          ctx.fillStyle = color;
          ctx.fillText(`${label} (${scoreText})`, bbox.x + 6, bbox.y - 8);
        }
      });
    };
    img.src = currentScreenshot.url;
  }, [
    currentScreenshot?.url,
    segments,
    selectedSegmentId,
    hoveredSegmentId,
    showSegmentation,
    showLabels,
    highlightMatches,
    maskImages,
    zoom,
    panOffset,
  ]);

  // Handle canvas click
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || segments.length === 0) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = canvasRef.current.width / rect.width;
      const scaleY = canvasRef.current.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      // Find clicked segment
      const clickedSegment = segments.find(
        (seg) =>
          x >= seg.bbox.x &&
          x <= seg.bbox.x + seg.bbox.width &&
          y >= seg.bbox.y &&
          y <= seg.bbox.y + seg.bbox.height
      );

      setSelectedSegmentId(clickedSegment?.id ?? null);
    },
    [segments]
  );

  // Handle canvas hover
  const handleCanvasMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || segments.length === 0) return;

      if (isDragging) {
        setPanOffset({
          x: panOffset.x + (e.clientX - dragStart.x) / zoom,
          y: panOffset.y + (e.clientY - dragStart.y) / zoom,
        });
        setDragStart({ x: e.clientX, y: e.clientY });
        return;
      }

      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = canvasRef.current.width / rect.width;
      const scaleY = canvasRef.current.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      // Find hovered segment
      const hoveredSeg = segments.find(
        (seg) =>
          x >= seg.bbox.x &&
          x <= seg.bbox.x + seg.bbox.width &&
          y >= seg.bbox.y &&
          y <= seg.bbox.y + seg.bbox.height
      );

      setHoveredSegmentId(hoveredSeg?.id ?? null);
    },
    [segments, isDragging, panOffset, dragStart, zoom]
  );

  // Handle mouse down for panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.shiftKey) {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  }, []);

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Run analysis
  const runAnalysis = async () => {
    if (!projectId) {
      toast.error("Please select a project first");
      return;
    }

    if (!currentScreenshot?.url) {
      toast.error("Please select a screenshot first");
      return;
    }

    setIsAnalyzing(true);
    setSegments([]);
    setAllMatches([]);
    setSelectedSegmentId(null);
    setMaskImages(new Map());

    try {
      const request: RAGFindRequest = {
        screenshot_base64: currentScreenshot.url,
        element_ids:
          searchMode === "specific" && selectedElementIds.length > 0
            ? selectedElementIds
            : undefined,
        similarity_threshold: similarityThreshold,
        matching_strategy: matchingStrategy,
        use_ocr: useOCR,
        return_segments: true,
        max_results: 50,
      };

      const fetchResponse = await fetch(
        `${QONTINUI_API_URL}/api/rag/projects/${projectId}/find`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        }
      );

      if (!fetchResponse.ok) {
        const errorData = await fetchResponse.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Analysis failed: ${fetchResponse.statusText}`
        );
      }

      const response: RAGFindResponse = await fetchResponse.json();

      if (!response.success) {
        throw new Error(response.error || "Analysis failed");
      }

      // Process segments and associate matches
      const segmentsWithMatches: SegmentWithMatches[] = (
        response.segments || []
      ).map((seg) => {
        // Find matches for this segment (by bbox overlap)
        const segMatches = response.matches.filter((match) => {
          const mb = match.bounding_box;
          const sb = seg.bbox;
          // Check if bounding boxes overlap significantly
          const overlapX = Math.max(
            0,
            Math.min(mb.x + mb.width, sb.x + sb.width) - Math.max(mb.x, sb.x)
          );
          const overlapY = Math.max(
            0,
            Math.min(mb.y + mb.height, sb.y + sb.height) - Math.max(mb.y, sb.y)
          );
          const overlapArea = overlapX * overlapY;
          const segArea = sb.width * sb.height;
          return overlapArea > segArea * 0.5; // 50% overlap threshold
        });

        // Sort by score and get best match
        segMatches.sort((a, b) => b.score - a.score);

        return {
          ...seg,
          matches: segMatches,
          bestMatch: segMatches[0] || null,
        };
      });

      setSegments(segmentsWithMatches);
      setAllMatches(response.matches);
      setProcessingTime(response.processing_time_ms);

      const matchCount = response.matches.length;
      const segmentCount = response.segment_count;
      toast.success(
        `Found ${matchCount} matches in ${segmentCount} segments (${response.processing_time_ms.toFixed(0)}ms)`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      toast.error(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Toggle element selection
  const toggleElementSelection = (elementId: string) => {
    setSelectedElementIds((prev) =>
      prev.includes(elementId)
        ? prev.filter((id) => id !== elementId)
        : [...prev, elementId]
    );
  };

  return (
    <div className="h-full flex bg-[#0A0A0B]">
      {/* Left Panel - Controls */}
      <div className="w-80 border-r border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
        <div className="space-y-4">
          {/* Screenshot Selection */}
          <ScreenshotPicker
            currentScreenshot={currentScreenshot}
            onUploadScreenshot={handleUploadScreenshot}
            onSelectProjectScreenshot={handleSelectProjectScreenshot}
            onClearScreenshot={handleClearScreenshot}
            enableCapture={true}
            className="bg-[#27272A]/50 border border-gray-700 rounded-lg"
          />

          {/* Search Mode */}
          <Card className="bg-[#27272A]/50 border-gray-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Search className="w-4 h-4" />
                Search Mode
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isSegmentationOnly ? (
                <div className="p-3 rounded-lg bg-[#00D9FF]/10 border border-[#00D9FF]/30">
                  <div className="flex items-center gap-2 mb-1">
                    <Layers className="w-4 h-4 text-[#00D9FF]" />
                    <span className="text-sm font-medium text-[#00D9FF]">
                      Segmentation Only
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    No RAG elements configured. Segmentation will run without
                    element matching.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant={searchMode === "filtered" ? "default" : "outline"}
                    onClick={() => setSearchMode("filtered")}
                    className="text-xs"
                  >
                    <Filter className="w-3 h-3 mr-1" />
                    All Elements
                  </Button>
                  <Button
                    size="sm"
                    variant={searchMode === "specific" ? "default" : "outline"}
                    onClick={() => setSearchMode("specific")}
                    className="text-xs"
                  >
                    <Target className="w-3 h-3 mr-1" />
                    Specific
                  </Button>
                </div>
              )}

              {!isSegmentationOnly && searchMode === "specific" && (
                <div className="space-y-2">
                  <Dialog
                    open={elementSelectorOpen}
                    onOpenChange={setElementSelectorOpen}
                  >
                    <DialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full border-gray-700 hover:border-[#00D9FF] justify-between"
                      >
                        <span>
                          {selectedElementIds.length > 0
                            ? `${selectedElementIds.length} selected`
                            : "Select Elements"}
                        </span>
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[80vh]">
                      <DialogHeader>
                        <DialogTitle>Select RAG Elements</DialogTitle>
                      </DialogHeader>
                      <ScrollArea className="h-[60vh] pr-4">
                        {loadingElements ? (
                          <div className="flex items-center justify-center py-8">
                            <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
                          </div>
                        ) : ragElements.length === 0 ? (
                          <div className="text-center py-8 text-gray-400">
                            No RAG elements found in this project
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {ragElements.map((element) => (
                              <div
                                key={element.id}
                                className={cn(
                                  "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                                  selectedElementIds.includes(element.id)
                                    ? "border-[#00D9FF] bg-[#00D9FF]/10"
                                    : "border-gray-700 hover:border-gray-600"
                                )}
                                onClick={() =>
                                  toggleElementSelection(element.id)
                                }
                              >
                                <Checkbox
                                  checked={selectedElementIds.includes(
                                    element.id
                                  )}
                                  onCheckedChange={() =>
                                    toggleElementSelection(element.id)
                                  }
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">
                                    {element.ocr_text ||
                                      element.text_description?.slice(0, 50) ||
                                      element.id}
                                  </div>
                                  {element.text_description && (
                                    <div className="text-xs text-gray-400 mt-1 line-clamp-2">
                                      {element.text_description}
                                    </div>
                                  )}
                                  <div className="flex gap-2 mt-2">
                                    {element.element_type && (
                                      <Badge
                                        variant="secondary"
                                        className="text-xs"
                                      >
                                        {element.element_type}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                      <div className="flex justify-between items-center pt-4 border-t">
                        <span className="text-sm text-gray-400">
                          {selectedElementIds.length} selected
                        </span>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            onClick={() => setSelectedElementIds([])}
                          >
                            Clear
                          </Button>
                          <Button onClick={() => setElementSelectorOpen(false)}>
                            Done
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Matching Options / Run Button */}
          <Card className="bg-[#27272A]/50 border-gray-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {isSegmentationOnly ? "Run" : "Matching Options"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isSegmentationOnly && (
                <>
                  <div>
                    <Label className="text-xs">Strategy</Label>
                    <Select
                      value={matchingStrategy}
                      onValueChange={(v) =>
                        setMatchingStrategy(v as MatchingStrategy)
                      }
                    >
                      <SelectTrigger className="mt-1 bg-[#27272A] border-gray-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="average">
                          Combined Embeddings
                        </SelectItem>
                        <SelectItem value="any_match">
                          Individual Patterns
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-gray-400 mt-1">
                      {matchingStrategy === "average"
                        ? "Average all pattern embeddings"
                        : "Match if any pattern exceeds threshold"}
                    </p>
                  </div>

                  <div>
                    <Label className="text-xs">
                      Similarity Threshold: {similarityThreshold.toFixed(2)}
                    </Label>
                    <Slider
                      value={[similarityThreshold]}
                      onValueChange={([v]) => setSimilarityThreshold(v ?? 0.7)}
                      min={0}
                      max={1}
                      step={0.05}
                      className="mt-1"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Enable OCR</Label>
                    <Switch checked={useOCR} onCheckedChange={setUseOCR} />
                  </div>
                </>
              )}

              <Button
                onClick={runAnalysis}
                disabled={!currentScreenshot?.url || isAnalyzing}
                className="w-full bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
              >
                {isAnalyzing ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    {isSegmentationOnly ? "Segmenting..." : "Analyzing..."}
                  </>
                ) : (
                  <>
                    {isSegmentationOnly ? (
                      <Layers className="w-4 h-4 mr-2" />
                    ) : (
                      <Target className="w-4 h-4 mr-2" />
                    )}
                    {isSegmentationOnly ? "Run Segmentation" : "Run Analysis"}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Display Options */}
          <Card className="bg-[#27272A]/50 border-gray-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Display Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Show Segmentation</Label>
                <Switch
                  checked={showSegmentation}
                  onCheckedChange={setShowSegmentation}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Show Labels</Label>
                <Switch checked={showLabels} onCheckedChange={setShowLabels} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Highlight Matches</Label>
                <Switch
                  checked={highlightMatches}
                  onCheckedChange={setHighlightMatches}
                />
              </div>
            </CardContent>
          </Card>

          {/* Results Summary */}
          {segments.length > 0 && (
            <Card className="bg-[#27272A]/50 border-gray-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Results</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">Segments:</span>
                  <span>{segments.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Matches:</span>
                  <span>{allMatches.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Processing:</span>
                  <span>{processingTime.toFixed(0)}ms</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Center Panel - Canvas */}
      <div
        ref={containerRef}
        className="flex-1 flex flex-col overflow-hidden bg-[#1A1A1B]"
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-[#27272A]/50">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setZoom((z) => Math.min(z * 1.25, 5))}
              className="h-8 w-8 p-0"
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setZoom((z) => Math.max(z / 1.25, 0.25))}
              className="h-8 w-8 p-0"
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-xs text-gray-400 ml-2">
              {Math.round(zoom * 100)}%
            </span>
          </div>
          <div className="text-xs text-gray-400">Shift+Click+Drag to pan</div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 overflow-auto p-4">
          {currentScreenshot?.url ? (
            <div
              style={{
                transform: `scale(${zoom}) translate(${panOffset.x}px, ${panOffset.y}px)`,
                transformOrigin: "top left",
              }}
            >
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                onMouseMove={handleCanvasMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                className="cursor-crosshair"
                style={{ maxWidth: "none" }}
              />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p>Select a screenshot to begin</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Details */}
      <div className="w-96 border-l border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
        <div className="space-y-4">
          {/* Selected Segment Details */}
          {selectedSegment ? (
            <>
              <Card className="bg-[#27272A]/50 border-gray-700">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    Segment Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-400">ID:</span>
                    <span className="font-mono">{selectedSegment.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Position:</span>
                    <span>
                      ({selectedSegment.bbox.x}, {selectedSegment.bbox.y})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Size:</span>
                    <span>
                      {selectedSegment.bbox.width} x{" "}
                      {selectedSegment.bbox.height}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Mask Density:</span>
                    <span>
                      {(selectedSegment.mask_density * 100).toFixed(1)}%
                    </span>
                  </div>
                  {selectedSegment.text_description && (
                    <div>
                      <span className="text-gray-400 block mb-1">
                        Segment Description:
                      </span>
                      <p className="text-gray-300 bg-black/20 rounded p-2">
                        {selectedSegment.text_description}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Match Scores */}
              {selectedSegment.matches.length > 0 ? (
                <Card className="bg-[#27272A]/50 border-gray-700">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      Match Scores ({selectedSegment.matches.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedSegment.matches.map((match, idx) => (
                      <div
                        key={`${match.element_id}-${idx}`}
                        className="p-3 rounded-lg border border-gray-700 space-y-3"
                      >
                        <div>
                          <div
                            className="font-medium text-sm"
                            style={{ color: getScoreColor(match.score) }}
                          >
                            {match.element_name}
                          </div>
                          {match.text_description && (
                            <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                              {match.text_description}
                            </p>
                          )}
                        </div>

                        {/* Score bars */}
                        <div className="space-y-2">
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-gray-400">Combined</span>
                              <span
                                style={{ color: getScoreColor(match.score) }}
                              >
                                {formatScore(match.score)}
                              </span>
                            </div>
                            <Progress
                              value={match.score * 100}
                              className="h-2"
                            />
                          </div>

                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-gray-400">Visual</span>
                              <span
                                style={{
                                  color: getScoreColor(match.visual_similarity),
                                }}
                              >
                                {formatScore(match.visual_similarity)}
                              </span>
                            </div>
                            <Progress
                              value={match.visual_similarity * 100}
                              className="h-2"
                            />
                          </div>

                          {match.text_similarity !== null && (
                            <div>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-400">Text</span>
                                <span
                                  style={{
                                    color: getScoreColor(match.text_similarity),
                                  }}
                                >
                                  {formatScore(match.text_similarity)}
                                </span>
                              </div>
                              <Progress
                                value={match.text_similarity * 100}
                                className="h-2"
                              />
                            </div>
                          )}

                          {match.ocr_similarity !== null && (
                            <div>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-400">OCR</span>
                                <span
                                  style={{
                                    color: getScoreColor(match.ocr_similarity),
                                  }}
                                >
                                  {formatScore(match.ocr_similarity)}
                                </span>
                              </div>
                              <Progress
                                value={match.ocr_similarity * 100}
                                className="h-2"
                              />
                            </div>
                          )}
                        </div>

                        {match.ocr_text && (
                          <div className="text-xs">
                            <span className="text-gray-400">OCR Text: </span>
                            <span className="text-gray-300">
                              &quot;{match.ocr_text}&quot;
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : (
                <Card className="bg-[#27272A]/50 border-gray-700">
                  <CardContent className="py-8 text-center text-gray-500">
                    <X className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No matches found for this segment</p>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card className="bg-[#27272A]/50 border-gray-700">
              <CardContent className="py-8 text-center text-gray-500">
                <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Click a segment to view details</p>
              </CardContent>
            </Card>
          )}

          {/* Segment List */}
          {segments.length > 0 && (
            <Card className="bg-[#27272A]/50 border-gray-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  All Segments ({segments.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                  <div className="space-y-1">
                    {segments.map((segment) => (
                      <div
                        key={segment.id}
                        className={cn(
                          "flex items-center justify-between p-2 rounded cursor-pointer transition-colors text-xs",
                          selectedSegmentId === segment.id
                            ? "bg-[#00D9FF]/20 border border-[#00D9FF]/50"
                            : "hover:bg-gray-800/50"
                        )}
                        onClick={() => setSelectedSegmentId(segment.id)}
                      >
                        <span className="font-mono">{segment.id}</span>
                        {segment.bestMatch ? (
                          <Badge
                            style={{
                              backgroundColor: `${getScoreColor(segment.bestMatch.score)}20`,
                              color: getScoreColor(segment.bestMatch.score),
                              borderColor: getScoreColor(
                                segment.bestMatch.score
                              ),
                            }}
                            variant="outline"
                          >
                            {formatScore(segment.bestMatch.score)}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="opacity-50">
                            No match
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
