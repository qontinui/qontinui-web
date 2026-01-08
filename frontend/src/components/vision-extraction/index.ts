/**
 * Vision Extraction Debug View Components
 *
 * Components for visualizing and debugging vision-based extraction results:
 * - EdgeDetectionView: Edge detection with Canny + contour analysis
 * - SAM3SegmentationView: SAM3 segment masks and boundaries
 * - OCRDetectionView: OCR text detection results
 * - MergedCandidatesView: Final merged StateImage candidates
 *
 * These components are designed to work with VisionExtractionResult from
 * the Python qontinui.extraction.vision module.
 */

export { EdgeDetectionView } from "./EdgeDetectionView";
export { SAM3SegmentationView } from "./SAM3SegmentationView";
export { OCRDetectionView } from "./OCRDetectionView";
export { MergedCandidatesView } from "./MergedCandidatesView";
export {
  ScreenshotCanvas,
  BoundingBoxOverlay,
  ContourOverlay,
} from "./ScreenshotCanvas";

// Re-export types for convenience
export type {
  VisionExtractionResult,
  ExtractedStateImageCandidate,
  EdgeDetectionResult,
  SAM3SegmentResult,
  OCRResult,
  ContourResult,
  BoundingBox,
  ScreenshotInfo,
  VisionExtractionConfig,
  EdgeDetectionConfig,
  SAM3Config,
  OCRConfig,
  FusionConfig,
} from "@/types/vision-extraction";
