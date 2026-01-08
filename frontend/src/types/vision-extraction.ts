/**
 * TypeScript types for Vision Extraction results.
 *
 * These types mirror the Python models from qontinui/extraction/vision/models.py
 * and are used for displaying debug views of each detection technique.
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedStateImageCandidate {
  id: string;
  bbox: BoundingBox;
  confidence: number;
  screenshot_id: string;
  cropped_image_path?: string | null;
  category?: string | null;
  text?: string | null;
  description?: string | null;
  extraction_method: string;
  detection_technique: string;
  source_url?: string | null;
  is_clickable: boolean;
  metadata?: Record<string, unknown>;
}

// Debug output models for individual detection techniques

export interface EdgeDetectionResult {
  id: string;
  bbox: BoundingBox;
  contour_area: number;
  contour_perimeter: number;
  vertex_count: number;
  aspect_ratio: number;
  confidence: number;
  contour_points?: [number, number][] | null;
}

export interface SAM3SegmentResult {
  id: string;
  bbox: BoundingBox;
  mask_area: number;
  stability_score: number;
  predicted_iou: number;
  confidence: number;
  mask_rle?: {
    shape: number[];
    runs: Array<{ start: number; length: number; value: number }>;
  } | null;
}

export interface OCRResult {
  id: string;
  bbox: BoundingBox;
  text: string;
  confidence: number;
  language: string;
  word_boxes?: Array<{
    points?: number[][];
    text?: string;
    confidence?: number;
  }> | null;
}

export interface ContourResult {
  id: string;
  bbox: BoundingBox;
  area: number;
  perimeter: number;
  hierarchy_level: number;
  parent_id?: string | null;
  children_ids: string[];
}

export interface ScreenshotInfo {
  id: string;
  path: string;
  width: number;
  height: number;
  captured_at: string;
  source_url?: string | null;
}

export interface VisionExtractionResult {
  extraction_id: string;
  extraction_method: string;
  candidates: ExtractedStateImageCandidate[];
  edge_detection_results?: EdgeDetectionResult[] | null;
  sam3_segments?: SAM3SegmentResult[] | null;
  ocr_results?: OCRResult[] | null;
  contour_results?: ContourResult[] | null;
  screenshots: ScreenshotInfo[];
  edge_overlay_image?: string | null;
  contour_overlay_image?: string | null;
  sam3_mask_image?: string | null;
  ocr_overlay_image?: string | null;
  started_at: string;
  completed_at?: string | null;
  duration_ms: number;
  errors: string[];
  warnings: string[];
  config: Record<string, unknown>;
}

// Configuration types

export interface EdgeDetectionConfig {
  enabled: boolean;
  canny_low: number;
  canny_high: number;
  min_contour_area: number;
  max_contour_area: number;
  aspect_ratio_min: number;
  aspect_ratio_max: number;
  approximation_epsilon: number;
}

export interface SAM3Config {
  enabled: boolean;
  model_type: string;
  points_per_side: number;
  pred_iou_thresh: number;
  stability_score_thresh: number;
  min_mask_region_area: number;
  max_mask_region_area: number;
}

export interface OCRConfig {
  enabled: boolean;
  engine: string;
  languages: string[];
  confidence_threshold: number;
  min_text_height: number;
  max_text_height: number;
}

export interface FusionConfig {
  iou_threshold: number;
  prefer_higher_confidence: boolean;
  max_candidates: number;
}

export interface VisionExtractionConfig {
  edge_detection: EdgeDetectionConfig;
  sam3: SAM3Config;
  ocr: OCRConfig;
  fusion: FusionConfig;
  save_debug_images: boolean;
  save_cropped_candidates: boolean;
  output_dir?: string | null;
}
