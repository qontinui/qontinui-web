/**
 * Vision Extraction Service
 *
 * Client for vision extraction (SAM3, Edge Detection, OCR).
 *
 * Uses the runner (port 9876) which calls the qontinui library via IPC.
 */

// Use 127.0.0.1 instead of localhost to force IPv4 (runner only listens on IPv4)
const RUNNER_URL =
  process.env.NEXT_PUBLIC_RUNNER_URL || "http://127.0.0.1:9876";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeDetectionResult {
  id: string;
  bbox: BoundingBox;
  confidence: number;
  contour_area: number;
  contour_perimeter: number;
  vertex_count: number;
  aspect_ratio: number;
  contour_points?: [number, number][] | null;
}

export interface SAM3SegmentResult {
  id: string;
  bbox: BoundingBox;
  stability_score: number;
  predicted_iou: number;
  mask_area: number;
  confidence: number;
}

export interface OCRResult {
  id: string;
  bbox: BoundingBox;
  text: string;
  confidence: number;
  language: string;
}

export interface ExtractedCandidate {
  id: string;
  bbox: BoundingBox;
  confidence: number;
  category?: string | null;
  text?: string | null;
  detection_technique: string;
  is_clickable: boolean;
}

export interface VisionExtractionResponse {
  screenshot_id: string;
  image_width: number;
  image_height: number;
  edge_results: EdgeDetectionResult[];
  sam3_results: SAM3SegmentResult[];
  ocr_results: OCRResult[];
  merged_candidates: ExtractedCandidate[];
  edge_overlay: string | null;
  sam3_overlay: string | null;
  ocr_overlay: string | null;
  techniques_run: string[];
  processing_time_ms: number;
}

export interface VisionExtractionRequest {
  screenshot: string; // base64 encoded
  techniques?: string[];
  // Edge detection config
  canny_low?: number;
  canny_high?: number;
  min_contour_area?: number;
  // SAM3 config
  points_per_side?: number;
  pred_iou_thresh?: number;
  stability_score_thresh?: number;
  // OCR config
  ocr_engine?: string;
  ocr_languages?: string[];
  ocr_confidence_threshold?: number;
  // Fusion config
  iou_threshold?: number;
}

export class VisionExtractionService {
  private runnerUrl: string;

  constructor(runnerUrl: string = RUNNER_URL) {
    this.runnerUrl = runnerUrl;
  }

  /**
   * Check if the runner is available
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.runnerUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Run vision extraction on a screenshot via the runner.
   */
  async extract(
    request: VisionExtractionRequest
  ): Promise<VisionExtractionResponse> {
    const requestBody = {
      screenshot: request.screenshot,
      techniques: request.techniques ?? ["edge", "sam3", "ocr"],
      canny_low: request.canny_low ?? 50,
      canny_high: request.canny_high ?? 150,
      min_contour_area: request.min_contour_area ?? 100,
      points_per_side: request.points_per_side ?? 32,
      pred_iou_thresh: request.pred_iou_thresh ?? 0.88,
      stability_score_thresh: request.stability_score_thresh ?? 0.95,
      ocr_engine: request.ocr_engine ?? "easyocr",
      ocr_languages: request.ocr_languages ?? ["en"],
      ocr_confidence_threshold: request.ocr_confidence_threshold ?? 0.5,
      iou_threshold: request.iou_threshold ?? 0.5,
    };

    const url = `${this.runnerUrl}/vision-extraction/extract`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Vision extraction failed: ${JSON.stringify(errorData)}`);
    }

    // Runner wraps response in ApiResponse { success, data, error }
    const apiResponse = await response.json();

    if (!apiResponse.success) {
      throw new Error(apiResponse.error || "Vision extraction failed");
    }

    // The actual data is nested in apiResponse.data
    const data = apiResponse.data;

    return {
      screenshot_id: data.extraction_id || "",
      image_width: data.image_width,
      image_height: data.image_height,
      edge_results: data.edge_results || [],
      sam3_results: data.sam3_results || [],
      ocr_results: data.ocr_results || [],
      merged_candidates: data.merged_candidates || [],
      edge_overlay: data.edge_overlay || null,
      sam3_overlay: data.sam3_overlay || null,
      ocr_overlay: data.ocr_overlay || null,
      techniques_run: data.techniques_run || [],
      processing_time_ms: data.processing_time_ms || 0,
    };
  }

  /**
   * Run only edge detection on a screenshot.
   */
  async extractEdges(
    screenshot: string,
    config?: {
      canny_low?: number;
      canny_high?: number;
      min_contour_area?: number;
    }
  ): Promise<VisionExtractionResponse> {
    return this.extract({
      screenshot,
      techniques: ["edge"],
      ...config,
    });
  }

  /**
   * Run only SAM3 segmentation on a screenshot.
   */
  async extractSAM3(
    screenshot: string,
    config?: {
      points_per_side?: number;
      pred_iou_thresh?: number;
      stability_score_thresh?: number;
    }
  ): Promise<VisionExtractionResponse> {
    return this.extract({
      screenshot,
      techniques: ["sam3"],
      ...config,
    });
  }

  /**
   * Run only OCR on a screenshot.
   */
  async extractOCR(
    screenshot: string,
    config?: {
      ocr_engine?: string;
      ocr_languages?: string[];
      ocr_confidence_threshold?: number;
    }
  ): Promise<VisionExtractionResponse> {
    return this.extract({
      screenshot,
      techniques: ["ocr"],
      ...config,
    });
  }
}

// Singleton instance
let visionExtractionServiceInstance: VisionExtractionService | null = null;

export function getVisionExtractionService(): VisionExtractionService {
  if (!visionExtractionServiceInstance) {
    visionExtractionServiceInstance = new VisionExtractionService();
  }
  return visionExtractionServiceInstance;
}
