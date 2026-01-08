"use client";

/**
 * Extraction Detail Page
 *
 * Displays extraction results with:
 * - Session metadata and statistics
 * - Detection technique tabs (Elements, States, SAM3, Edge, OCR)
 * - Screenshot viewer with bounding box overlays
 * - Real vision extraction via Desktop Runner (runs locally on user's machine)
 */

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { runnerClient } from "@/lib/runner-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Download,
  Trash2,
  Image as ImageIcon,
  Eye,
  Box,
  Clock,
  AlertCircle,
  Loader2,
  Layers,
  Grid3X3,
  ScanLine,
  Type,
  RefreshCw,
  Play,
} from "lucide-react";
import {
  getVisionExtractionService,
  type VisionExtractionResponse,
  type EdgeDetectionResult,
  type SAM3SegmentResult,
  type OCRResult,
} from "@/services/vision-extraction-service";

// Types
interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ElementAnnotation {
  id: string;
  bbox: BoundingBox;
  element_type: string;
  text_content: string | null;
  selector: string;
  is_interactive: boolean;
  confidence?: number;
}

interface StateAnnotation {
  id: string;
  name: string;
  bbox: BoundingBox;
  state_type: string;
  element_ids: string[];
}

interface VisionResults {
  extraction_id?: string;
  duration_ms?: number;
  techniques_run: string[];
  edge_results: EdgeDetectionResult[];
  sam3_results: SAM3SegmentResult[];
  ocr_results: OCRResult[];
  merged_candidates: Array<{
    id: string;
    bbox: BoundingBox;
    confidence: number;
    category?: string;
    text?: string;
    detection_technique: string;
    is_clickable: boolean;
  }>;
  edge_overlay?: string | null;
  sam3_overlay?: string | null;
  ocr_overlay?: string | null;
}

interface ExtractionAnnotation {
  id: string;
  session_id: string;
  screenshot_id: string;
  source_url: string;
  viewport_width: number;
  viewport_height: number;
  elements: ElementAnnotation[];
  states: StateAnnotation[];
  vision_results?: VisionResults | null;
}

interface ExtractionSession {
  id: string;
  project_id: string;
  source_urls: string[];
  config: Record<string, unknown>;
  status: string;
  stats: {
    pages_extracted?: number;
    elements_found?: number;
    states_found?: number;
  };
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  annotations: ExtractionAnnotation[];
}

// Colors for different element types
const ELEMENT_COLORS: Record<string, { stroke: string; fill: string }> = {
  button: { stroke: "#22c55e", fill: "rgba(34, 197, 94, 0.2)" },
  input: { stroke: "#3b82f6", fill: "rgba(59, 130, 246, 0.2)" },
  link: { stroke: "#a855f7", fill: "rgba(168, 85, 247, 0.2)" },
  checkbox: { stroke: "#eab308", fill: "rgba(234, 179, 8, 0.2)" },
  text: { stroke: "#9ca3af", fill: "rgba(156, 163, 175, 0.1)" },
  image: { stroke: "#06b6d4", fill: "rgba(6, 182, 212, 0.2)" },
  default: { stroke: "#ffffff", fill: "rgba(255, 255, 255, 0.1)" },
};

// Colors for states
const STATE_COLORS = [
  { stroke: "#ef4444", fill: "rgba(239, 68, 68, 0.3)" },
  { stroke: "#22c55e", fill: "rgba(34, 197, 94, 0.3)" },
  { stroke: "#3b82f6", fill: "rgba(59, 130, 246, 0.3)" },
  { stroke: "#eab308", fill: "rgba(234, 179, 8, 0.3)" },
  { stroke: "#a855f7", fill: "rgba(168, 85, 247, 0.3)" },
];

// SAM3 segment colors (for demo)
const SAM3_COLORS = [
  { stroke: "#f97316", fill: "rgba(249, 115, 34, 0.4)" },
  { stroke: "#14b8a6", fill: "rgba(20, 184, 166, 0.4)" },
  { stroke: "#8b5cf6", fill: "rgba(139, 92, 246, 0.4)" },
  { stroke: "#ec4899", fill: "rgba(236, 72, 153, 0.4)" },
];

type DetectionTechnique = "elements" | "states" | "sam3" | "edge" | "ocr";

export default function ExtractionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const extractionId = params.extractionId as string;
  const projectId = searchParams.get("project");

  const [extraction, setExtraction] = useState<ExtractionSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Screenshot state
  const [selectedAnnotationIdx, setSelectedAnnotationIdx] = useState(0);
  const [screenshotCache, setScreenshotCache] = useState<Map<string, string>>(
    new Map()
  );
  const [loadingScreenshot, setLoadingScreenshot] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);

  // Detection technique
  const [technique, setTechnique] = useState<DetectionTechnique>("elements");

  // Vision extraction state
  const [visionResults, setVisionResults] = useState<
    Map<string, VisionExtractionResponse>
  >(new Map());
  const [runningVision, setRunningVision] = useState(false);

  const [_visionError, setVisionError] = useState<string | null>(null);

  // Uploaded screenshot for vision testing (when runner screenshots not available)
  const [uploadedScreenshot, setUploadedScreenshot] = useState<string | null>(
    null
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadExtraction();
  }, [extractionId]);

  const loadExtraction = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getExtractionSession(extractionId);
      setExtraction(data as ExtractionSession);
    } catch (error) {
      console.error("Error loading extraction:", error);
      toast.error("Failed to load extraction session");
    } finally {
      setLoading(false);
    }
  };

  // Get selected annotation
  const selectedAnnotation = extraction?.annotations?.[selectedAnnotationIdx];

  // Load screenshot
  const loadScreenshot = useCallback(async () => {
    if (!selectedAnnotation || !extractionId) return;

    const screenshotId = selectedAnnotation.screenshot_id;
    if (screenshotCache.has(screenshotId)) return;

    setLoadingScreenshot(true);
    setScreenshotError(null);

    try {
      const result = await runnerClient.getExtractionScreenshot(
        extractionId,
        screenshotId
      );
      if (result.success && result.blob) {
        const url = URL.createObjectURL(result.blob);
        setScreenshotCache((prev) => new Map(prev).set(screenshotId, url));
      } else {
        setScreenshotError(
          result.error || "Screenshot not available. Is the Runner running?"
        );
      }
    } catch (error) {
      console.error("Failed to load screenshot:", error);
      setScreenshotError(
        "Failed to load screenshot. Make sure the Runner is connected."
      );
    } finally {
      setLoadingScreenshot(false);
    }
  }, [selectedAnnotation, extractionId, screenshotCache]);

  // Load screenshot when annotation changes
  useEffect(() => {
    if (selectedAnnotation) {
      loadScreenshot();
    }
  }, [selectedAnnotation, loadScreenshot]);

  // Run vision extraction on current screenshot
  const runVisionExtraction = useCallback(async () => {
    let base64: string;
    let resultKey: string;

    // Check for uploaded screenshot first, then cached screenshot
    if (uploadedScreenshot) {
      base64 = uploadedScreenshot;
      resultKey = "uploaded";
    } else if (selectedAnnotation) {
      const screenshotUrl = screenshotCache.get(
        selectedAnnotation.screenshot_id
      );
      if (!screenshotUrl) {
        toast.error(
          "No screenshot available. Upload a screenshot or ensure the Runner is connected."
        );
        return;
      }
      // Convert blob URL to base64
      const response = await fetch(screenshotUrl);
      const blob = await response.blob();
      base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      resultKey = selectedAnnotation.screenshot_id;
    } else {
      toast.error("No screenshot available. Upload a screenshot first.");
      return;
    }

    setRunningVision(true);
    setVisionError(null);

    try {
      // Run vision extraction
      const service = getVisionExtractionService();
      const results = await service.extract({
        screenshot: base64,
        techniques: ["edge", "sam3", "ocr"],
      });

      setVisionResults((prev) => new Map(prev).set(resultKey, results));
      toast.success(
        `Vision extraction complete: ${results.edge_results.length} edges, ${results.sam3_results.length} segments, ${results.ocr_results.length} text regions`
      );
    } catch (error) {
      console.error("Vision extraction failed:", error);
      setVisionError(
        error instanceof Error ? error.message : "Vision extraction failed"
      );
      toast.error(
        "Vision extraction failed. Re-run the extraction with Desktop Runner for automatic vision processing."
      );
    } finally {
      setRunningVision(false);
    }
  }, [selectedAnnotation, screenshotCache, uploadedScreenshot]);

  // Handle file upload for vision extraction
  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target?.result as string;
        setUploadedScreenshot(base64);
        toast.success("Screenshot uploaded. Click 'Run Vision' to analyze.");
      };
      reader.readAsDataURL(file);
    },
    []
  );

  // Get current vision results - prefer annotation's vision_results, fall back to manually run results
  const currentVisionResults: VisionExtractionResponse | undefined =
    selectedAnnotation?.vision_results
      ? {
          // Convert annotation vision_results to VisionExtractionResponse format
          screenshot_id: selectedAnnotation.screenshot_id,
          image_width: selectedAnnotation.viewport_width,
          image_height: selectedAnnotation.viewport_height,
          edge_results: selectedAnnotation.vision_results.edge_results || [],
          sam3_results: selectedAnnotation.vision_results.sam3_results || [],
          ocr_results: selectedAnnotation.vision_results.ocr_results || [],
          merged_candidates:
            selectedAnnotation.vision_results.merged_candidates || [],
          edge_overlay: selectedAnnotation.vision_results.edge_overlay || null,
          sam3_overlay: selectedAnnotation.vision_results.sam3_overlay || null,
          ocr_overlay: selectedAnnotation.vision_results.ocr_overlay || null,
          techniques_run:
            selectedAnnotation.vision_results.techniques_run || [],
          processing_time_ms:
            selectedAnnotation.vision_results.duration_ms || 0,
        }
      : selectedAnnotation
        ? visionResults.get(selectedAnnotation.screenshot_id)
        : uploadedScreenshot
          ? visionResults.get("uploaded")
          : undefined;

  // Get the screenshot to display (from cache or uploaded)
  const displayScreenshot = selectedAnnotation
    ? screenshotCache.get(selectedAnnotation.screenshot_id)
    : null;
  const hasScreenshot = !!displayScreenshot || !!uploadedScreenshot;

  // Draw on canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Get screenshot source: uploaded, cached, or none
    const screenshotUrl =
      uploadedScreenshot ||
      (selectedAnnotation
        ? screenshotCache.get(selectedAnnotation.screenshot_id)
        : null);

    const draw = () => {
      // Clear canvas
      ctx.fillStyle = "#1a1a1b";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (!screenshotUrl) {
        // No screenshot - draw placeholder with upload prompt
        canvas.width = 800;
        canvas.height = 600;
        ctx.fillStyle = "#1a1a1b";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "#6b7280";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          "Screenshot not available",
          canvas.width / 2,
          canvas.height / 2 - 30
        );
        ctx.fillText(
          "Runner not connected or screenshots not stored.",
          canvas.width / 2,
          canvas.height / 2
        );
        ctx.fillStyle = "#00D9FF";
        ctx.fillText(
          "Click 'Upload Screenshot' to upload an image for vision analysis.",
          canvas.width / 2,
          canvas.height / 2 + 30
        );
        return;
      }

      const img = new Image();
      img.src = screenshotUrl;
      img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);

        // Draw based on selected technique
        if (technique === "elements" && selectedAnnotation?.elements) {
          drawElements(ctx, selectedAnnotation.elements);
        } else if (technique === "states" && selectedAnnotation?.states) {
          drawStates(ctx, selectedAnnotation.states);
        } else if (technique === "sam3") {
          drawSAM3Results(
            ctx,
            currentVisionResults?.sam3_results || [],
            img.naturalWidth,
            img.naturalHeight
          );
        } else if (technique === "edge") {
          drawEdgeResults(
            ctx,
            currentVisionResults?.edge_results || [],
            img.naturalWidth,
            img.naturalHeight
          );
        } else if (technique === "ocr") {
          drawOCRResults(ctx, currentVisionResults?.ocr_results || []);
        }
      };
    };

    draw();
  }, [
    selectedAnnotation,
    screenshotCache,
    technique,
    currentVisionResults,
    uploadedScreenshot,
  ]);

  // Draw elements
  const drawElements = (
    ctx: CanvasRenderingContext2D,
    elements: ElementAnnotation[]
  ) => {
    for (const element of elements) {
      const colors =
        ELEMENT_COLORS[element.element_type] ?? ELEMENT_COLORS.default!;
      const { x, y, width, height } = element.bbox;

      ctx.strokeStyle = colors.stroke;
      ctx.fillStyle = colors.fill;
      ctx.lineWidth = 2;

      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);

      // Label
      const label = element.text_content?.slice(0, 25) || element.element_type;
      ctx.font = "11px sans-serif";
      const textWidth = ctx.measureText(label).width;
      const labelY = y > 16 ? y - 4 : y + height + 14;

      ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
      ctx.fillRect(x, labelY - 12, textWidth + 6, 14);
      ctx.fillStyle = colors.stroke;
      ctx.fillText(label, x + 3, labelY - 1);
    }
  };

  // Draw states
  const drawStates = (
    ctx: CanvasRenderingContext2D,
    states: StateAnnotation[]
  ) => {
    states.forEach((state, idx) => {
      const colors = STATE_COLORS[idx % STATE_COLORS.length]!;
      const { x, y, width, height } = state.bbox;

      ctx.strokeStyle = colors.stroke;
      ctx.fillStyle = colors.fill;
      ctx.lineWidth = 3;

      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);

      // Label
      ctx.font = "bold 12px sans-serif";
      const textWidth = ctx.measureText(state.name).width;
      const labelY = y > 20 ? y - 6 : y + height + 16;

      ctx.fillStyle = colors.stroke;
      ctx.fillRect(x, labelY - 14, textWidth + 8, 18);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(state.name, x + 4, labelY);
    });
  };

  // Draw SAM3 segmentation results
  const drawSAM3Results = (
    ctx: CanvasRenderingContext2D,
    segments: SAM3SegmentResult[],
    _width: number,
    _height: number
  ) => {
    void _width;
    void _height;

    if (segments.length === 0) {
      // No results - vision extraction runs automatically during extraction
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(10, 10, 380, 24);
      ctx.fillStyle = "#f97316";
      ctx.font = "12px sans-serif";
      ctx.fillText(
        "No SAM3 results. Vision runs automatically during extraction.",
        16,
        26
      );
      return;
    }

    // Draw each segment
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const color = SAM3_COLORS[i % SAM3_COLORS.length]!;
      const { x, y, width, height } = seg.bbox;

      ctx.strokeStyle = color.stroke;
      ctx.fillStyle = color.fill;
      ctx.lineWidth = 2;
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);

      // Label with score
      const label = `${Math.round(seg.stability_score * 100)}%`;
      ctx.font = "10px sans-serif";
      const textWidth = ctx.measureText(label).width;
      const labelY = y > 14 ? y - 3 : y + height + 12;

      ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
      ctx.fillRect(x, labelY - 10, textWidth + 6, 13);
      ctx.fillStyle = color.stroke;
      ctx.fillText(label, x + 3, labelY);
    }

    // Info text
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(10, 10, 280, 24);
    ctx.fillStyle = "#f97316";
    ctx.font = "12px sans-serif";
    ctx.fillText(`SAM3 Segments: ${segments.length} detected`, 16, 26);
  };

  // Draw edge detection results
  const drawEdgeResults = (
    ctx: CanvasRenderingContext2D,
    edges: EdgeDetectionResult[],
    _width: number,
    _height: number
  ) => {
    void _width;
    void _height;

    if (edges.length === 0) {
      // No results - vision extraction runs automatically during extraction
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(10, 10, 380, 24);
      ctx.fillStyle = "#00ff00";
      ctx.font = "12px sans-serif";
      ctx.fillText(
        "No edge results. Vision runs automatically during extraction.",
        16,
        26
      );
      return;
    }

    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = 2;

    for (const edge of edges) {
      const { x, y, width, height } = edge.bbox;

      // Draw contour if available
      if (edge.contour_points && edge.contour_points.length > 0) {
        ctx.beginPath();
        ctx.moveTo(edge.contour_points[0]![0], edge.contour_points[0]![1]);
        for (let i = 1; i < edge.contour_points.length; i++) {
          ctx.lineTo(edge.contour_points[i]![0], edge.contour_points[i]![1]);
        }
        ctx.closePath();
        ctx.stroke();
      } else {
        // Draw bounding box
        ctx.strokeRect(x, y, width, height);
      }

      // Label with vertex count
      const label = `${edge.vertex_count}v`;
      ctx.font = "9px sans-serif";
      const textWidth = ctx.measureText(label).width;

      ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
      ctx.fillRect(x, y - 12, textWidth + 4, 12);
      ctx.fillStyle = "#00ff00";
      ctx.fillText(label, x + 2, y - 2);
    }

    // Info text
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(10, 10, 280, 24);
    ctx.fillStyle = "#00ff00";
    ctx.font = "12px sans-serif";
    ctx.fillText(`Edge Detection: ${edges.length} contours`, 16, 26);
  };

  // Draw OCR results
  const drawOCRResults = (
    ctx: CanvasRenderingContext2D,
    ocrResults: OCRResult[]
  ) => {
    if (ocrResults.length === 0) {
      // No results - vision extraction runs automatically during extraction
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(10, 10, 380, 24);
      ctx.fillStyle = "#a855f7";
      ctx.font = "12px sans-serif";
      ctx.fillText(
        "No OCR results. Vision runs automatically during extraction.",
        16,
        26
      );
      return;
    }

    for (const ocr of ocrResults) {
      const { x, y, width, height } = ocr.bbox;

      ctx.strokeStyle = "#a855f7";
      ctx.fillStyle = "rgba(168, 85, 247, 0.2)";
      ctx.lineWidth = 2;

      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);

      // Text label
      const text = ocr.text.slice(0, 30);
      ctx.font = "10px monospace";
      const textWidth = ctx.measureText(text).width;
      const labelY = y > 14 ? y - 3 : y + height + 12;

      ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
      ctx.fillRect(x, labelY - 10, Math.min(textWidth + 6, width + 50), 13);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, x + 3, labelY);
    }

    // Info text
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(10, 10, 280, 24);
    ctx.fillStyle = "#a855f7";
    ctx.font = "12px sans-serif";
    ctx.fillText(`OCR: ${ocrResults.length} text regions`, 16, 26);
  };

  const handleImportStates = async () => {
    if (!extraction) return;
    setImporting(true);
    try {
      const result = await apiClient.importExtractionStates(extractionId, {
        state_ids: [],
      });
      toast.success(`Imported ${result.imported_states} state(s)`);
    } catch (error) {
      console.error("Error importing states:", error);
      toast.error("Failed to import states");
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this extraction session?")) return;
    setDeleting(true);
    try {
      await apiClient.deleteExtractionSession(extractionId);
      toast.success("Extraction deleted");
      router.push(`/extractions?project=${projectId}`);
    } catch (error) {
      console.error("Error deleting extraction:", error);
      toast.error("Failed to delete");
      setDeleting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      completed: "bg-green-500/20 text-green-400 border-green-500/30",
      running: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      failed: "bg-red-500/20 text-red-400 border-red-500/30",
    };
    return variants[status] || "bg-surface-raised/20 text-text-muted";
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
      </div>
    );
  }

  if (!extraction) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="mb-4">Extraction not found</p>
            <Link href={`/extractions?project=${projectId}`}>
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Extractions
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalElements =
    extraction.annotations?.reduce(
      (sum, a) => sum + (a.elements?.length || 0),
      0
    ) || 0;
  const totalStates =
    extraction.annotations?.reduce(
      (sum, a) => sum + (a.states?.length || 0),
      0
    ) || 0;

  return (
    <div className="min-h-screen p-6 pb-20">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/extractions?project=${projectId}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              Extraction Results
              <Badge className={getStatusBadge(extraction.status)}>
                {extraction.status}
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground">
              {extraction.source_urls[0]}
              {extraction.source_urls.length > 1 &&
                ` +${extraction.source_urls.length - 1} more`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleImportStates}
            disabled={importing || totalStates === 0}
          >
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Import States
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Delete
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
            <div>
              <div className="text-2xl font-bold">
                {extraction.annotations?.length || 0}
              </div>
              <div className="text-xs text-muted-foreground">Screenshots</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Box className="h-8 w-8 text-muted-foreground" />
            <div>
              <div className="text-2xl font-bold">{totalElements}</div>
              <div className="text-xs text-muted-foreground">Elements</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Eye className="h-8 w-8 text-muted-foreground" />
            <div>
              <div className="text-2xl font-bold">{totalStates}</div>
              <div className="text-xs text-muted-foreground">States</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="h-8 w-8 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">
                {new Date(extraction.created_at).toLocaleDateString()}
              </div>
              <div className="text-xs text-muted-foreground">Created</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      {extraction.annotations && extraction.annotations.length > 0 ? (
        <div className="flex gap-6">
          {/* Left: Page selector */}
          <Card className="w-56 shrink-0">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">
                Pages ({extraction.annotations.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 max-h-[600px] overflow-y-auto">
              <div className="space-y-2">
                {extraction.annotations.map((annotation, idx) => (
                  <button
                    key={annotation.id}
                    onClick={() => setSelectedAnnotationIdx(idx)}
                    className={`w-full text-left p-2 rounded-lg border transition-all ${
                      idx === selectedAnnotationIdx
                        ? "border-brand-primary bg-brand-primary/10"
                        : "border-border hover:border-foreground/20"
                    }`}
                  >
                    <div className="text-xs font-medium truncate">
                      {(() => {
                        try {
                          return new URL(annotation.source_url).pathname || "/";
                        } catch {
                          return annotation.source_url.slice(0, 30);
                        }
                      })()}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {annotation.elements?.length || 0} elements •{" "}
                      {annotation.states?.length || 0} states
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Right: Detection visualization */}
          <div className="flex-1 min-w-0">
            <Card>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between gap-4">
                  <CardTitle className="text-sm">Detection Results</CardTitle>
                  <div className="flex items-center gap-2">
                    <Tabs
                      value={technique}
                      onValueChange={(v) =>
                        setTechnique(v as DetectionTechnique)
                      }
                    >
                      <TabsList className="h-8">
                        <TabsTrigger
                          value="elements"
                          className="text-xs px-3 h-7"
                        >
                          <Box className="h-3 w-3 mr-1" />
                          Elements
                        </TabsTrigger>
                        <TabsTrigger
                          value="states"
                          className="text-xs px-3 h-7"
                        >
                          <Layers className="h-3 w-3 mr-1" />
                          States
                        </TabsTrigger>
                        <TabsTrigger value="sam3" className="text-xs px-3 h-7">
                          <Grid3X3 className="h-3 w-3 mr-1" />
                          SAM3
                        </TabsTrigger>
                        <TabsTrigger value="edge" className="text-xs px-3 h-7">
                          <ScanLine className="h-3 w-3 mr-1" />
                          Edge
                        </TabsTrigger>
                        <TabsTrigger value="ocr" className="text-xs px-3 h-7">
                          <Type className="h-3 w-3 mr-1" />
                          OCR
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-8"
                    >
                      <ImageIcon className="h-4 w-4 mr-1" />
                      Upload
                    </Button>
                    {selectedAnnotation?.vision_results ? (
                      <Badge
                        variant="outline"
                        className="h-8 px-3 bg-green-500/10 border-green-500/30 text-green-400"
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Vision Available
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={runVisionExtraction}
                        disabled={runningVision || !hasScreenshot}
                        className="h-8"
                      >
                        {runningVision ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 mr-1" />
                        )}
                        Run Vision
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {/* Screenshot viewer */}
                <div className="relative">
                  {loadingScreenshot && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                      <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
                    </div>
                  )}

                  {screenshotError && (
                    <div className="absolute top-4 left-4 right-4 z-10">
                      <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-3 flex items-center gap-3">
                        <AlertCircle className="h-5 w-5 text-yellow-500 shrink-0" />
                        <div className="flex-1 text-sm text-yellow-200">
                          {screenshotError}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={loadScreenshot}
                        >
                          <RefreshCw className="h-4 w-4 mr-1" />
                          Retry
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="overflow-auto max-h-[600px] bg-muted/20">
                    <canvas
                      ref={canvasRef}
                      className="block mx-auto"
                      style={{ maxWidth: "100%" }}
                    />
                  </div>
                </div>

                {/* Legend */}
                <div className="p-3 border-t bg-muted/10">
                  <div className="flex flex-wrap gap-4 text-xs">
                    {technique === "elements" && (
                      <>
                        {Object.entries(ELEMENT_COLORS)
                          .filter(([k]) => k !== "default")
                          .map(([type, colors]) => (
                            <div key={type} className="flex items-center gap-1">
                              <div
                                className="w-3 h-3 rounded border"
                                style={{
                                  backgroundColor: colors.fill,
                                  borderColor: colors.stroke,
                                }}
                              />
                              <span>{type}</span>
                            </div>
                          ))}
                      </>
                    )}
                    {technique === "states" &&
                      selectedAnnotation?.states?.map((state, idx) => (
                        <div key={state.id} className="flex items-center gap-1">
                          <div
                            className="w-3 h-3 rounded border"
                            style={{
                              backgroundColor:
                                STATE_COLORS[idx % STATE_COLORS.length]!.fill,
                              borderColor:
                                STATE_COLORS[idx % STATE_COLORS.length]!.stroke,
                            }}
                          />
                          <span>{state.name}</span>
                        </div>
                      ))}
                    {technique === "sam3" &&
                      (currentVisionResults?.sam3_results.length ? (
                        <span className="text-muted-foreground">
                          {currentVisionResults.sam3_results.length} segments
                          detected •{" "}
                          {currentVisionResults.processing_time_ms.toFixed(0)}ms
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          No SAM3 results. Vision extraction runs automatically
                          during extraction.
                        </span>
                      ))}
                    {technique === "edge" &&
                      (currentVisionResults?.edge_results.length ? (
                        <span className="text-muted-foreground">
                          {currentVisionResults.edge_results.length} contours
                          detected •{" "}
                          {currentVisionResults.processing_time_ms.toFixed(0)}ms
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          No edge results. Vision extraction runs automatically
                          during extraction.
                        </span>
                      ))}
                    {technique === "ocr" &&
                      (currentVisionResults?.ocr_results.length ? (
                        <span className="text-muted-foreground">
                          {currentVisionResults.ocr_results.length} text regions
                          detected •{" "}
                          {currentVisionResults.processing_time_ms.toFixed(0)}ms
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          No OCR results. Vision extraction runs automatically
                          during extraction.
                        </span>
                      ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Element/State List */}
            {selectedAnnotation &&
              (technique === "elements" || technique === "states") && (
                <Card className="mt-4">
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">
                      {technique === "elements" ? "Elements" : "States"} on this
                      page
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 max-h-[300px] overflow-y-auto">
                    <div className="divide-y">
                      {technique === "elements" &&
                        selectedAnnotation.elements?.map((element) => (
                          <div
                            key={element.id}
                            className="p-3 hover:bg-accent/50"
                          >
                            <div className="flex items-center justify-between">
                              <Badge
                                variant="outline"
                                style={{
                                  borderColor:
                                    ELEMENT_COLORS[element.element_type]
                                      ?.stroke || "#fff",
                                  color:
                                    ELEMENT_COLORS[element.element_type]
                                      ?.stroke || "#fff",
                                }}
                              >
                                {element.element_type}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {element.bbox.width}x{element.bbox.height}
                              </span>
                            </div>
                            {element.text_content && (
                              <div className="text-sm text-muted-foreground mt-1 truncate">
                                {element.text_content}
                              </div>
                            )}
                          </div>
                        ))}
                      {technique === "states" &&
                        selectedAnnotation.states?.map((state, idx) => (
                          <div
                            key={state.id}
                            className="p-3 hover:bg-accent/50"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-3 h-3 rounded"
                                  style={{
                                    backgroundColor:
                                      STATE_COLORS[idx % STATE_COLORS.length]!
                                        .stroke,
                                  }}
                                />
                                <span className="font-medium">
                                  {state.name}
                                </span>
                              </div>
                              <Badge variant="outline">
                                {state.state_type}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {state.element_ids?.length || 0} elements •{" "}
                              {state.bbox.width}x{state.bbox.height}
                            </div>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}

            {/* Vision Extraction Results List */}
            {currentVisionResults &&
              (technique === "sam3" ||
                technique === "edge" ||
                technique === "ocr") && (
                <Card className="mt-4">
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">
                      {technique === "sam3" &&
                        `SAM3 Segments (${currentVisionResults.sam3_results.length})`}
                      {technique === "edge" &&
                        `Edge Contours (${currentVisionResults.edge_results.length})`}
                      {technique === "ocr" &&
                        `OCR Text Regions (${currentVisionResults.ocr_results.length})`}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 max-h-[300px] overflow-y-auto">
                    <div className="divide-y">
                      {technique === "sam3" &&
                        currentVisionResults.sam3_results.map((seg, idx) => (
                          <div key={seg.id} className="p-3 hover:bg-accent/50">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-3 h-3 rounded"
                                  style={{
                                    backgroundColor:
                                      SAM3_COLORS[idx % SAM3_COLORS.length]!
                                        .stroke,
                                  }}
                                />
                                <span className="font-medium text-sm">
                                  Segment {idx + 1}
                                </span>
                              </div>
                              <Badge variant="outline">
                                {Math.round(seg.stability_score * 100)}%
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Area: {seg.mask_area.toLocaleString()}px • IoU:{" "}
                              {seg.predicted_iou.toFixed(2)} • {seg.bbox.width}x
                              {seg.bbox.height}
                            </div>
                          </div>
                        ))}
                      {technique === "edge" &&
                        currentVisionResults.edge_results.map((edge, idx) => (
                          <div key={edge.id} className="p-3 hover:bg-accent/50">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded bg-green-500" />
                                <span className="font-medium text-sm">
                                  Contour {idx + 1}
                                </span>
                              </div>
                              <Badge variant="outline">
                                {edge.vertex_count} vertices
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Area:{" "}
                              {Math.round(edge.contour_area).toLocaleString()}px
                              • Aspect: {edge.aspect_ratio.toFixed(2)} •{" "}
                              {edge.bbox.width}x{edge.bbox.height}
                            </div>
                          </div>
                        ))}
                      {technique === "ocr" &&
                        currentVisionResults.ocr_results.map((ocr) => (
                          <div key={ocr.id} className="p-3 hover:bg-accent/50">
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <span className="font-medium text-sm truncate block">
                                  &quot;{ocr.text}&quot;
                                </span>
                              </div>
                              <Badge
                                variant="outline"
                                className="ml-2 shrink-0"
                              >
                                {Math.round(ocr.confidence * 100)}%
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Language: {ocr.language} • {ocr.bbox.width}x
                              {ocr.bbox.height} at ({ocr.bbox.x}, {ocr.bbox.y})
                            </div>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <ImageIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">
              No extraction data available
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
