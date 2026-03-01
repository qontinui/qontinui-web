import type { BoundingBox } from "@/components/common/ImageCanvas";
import type {
  DatasetAnnotation,
  DatasetFilters,
  AnnotationSource,
  ReviewStatus,
} from "@/types/dataset";

// ============================================================================
// Color constants
// ============================================================================

export const SOURCE_COLORS: Record<AnnotationSource, string> = {
  user_click: "#22c55e", // Green
  smart_click_analysis: "#3b82f6", // Blue
  template_matching: "#f97316", // Orange
  manual: "#8b5cf6", // Purple
};

export const REVIEW_STATUS_COLORS: Record<ReviewStatus, string> = {
  pending: "#6b7280", // Gray
  approved: "#22c55e", // Green
  rejected: "#ef4444", // Red
  flagged: "#eab308", // Yellow
};

// ============================================================================
// Source/status lists for filter rendering
// ============================================================================

export const ANNOTATION_SOURCES: AnnotationSource[] = [
  "user_click",
  "smart_click_analysis",
  "template_matching",
  "manual",
];

export const REVIEW_STATUSES: ReviewStatus[] = [
  "pending",
  "approved",
  "rejected",
  "flagged",
];

// ============================================================================
// Pure utility functions
// ============================================================================

/**
 * Filter annotations based on the current filter settings.
 */
export function filterAnnotations(
  annotations: DatasetAnnotation[],
  filters: DatasetFilters
): DatasetAnnotation[] {
  return annotations.filter((ann) => {
    if (filters.sources && !filters.sources.includes(ann.source)) return false;
    if (
      filters.confidence_min !== undefined &&
      ann.confidence < filters.confidence_min
    )
      return false;
    if (
      filters.confidence_max !== undefined &&
      ann.confidence > filters.confidence_max
    )
      return false;
    if (
      filters.review_statuses &&
      !filters.review_statuses.includes(ann.review_status)
    )
      return false;
    return true;
  });
}

/**
 * Convert DatasetAnnotation[] to BoundingBox[] for ImageCanvas.
 */
export function annotationsToCanvasBoxes(
  annotations: DatasetAnnotation[]
): BoundingBox[] {
  return annotations.map((ann) => ({
    id: ann.id,
    x: ann.x,
    y: ann.y,
    width: ann.width,
    height: ann.height,
    label: ann.category_name,
    color: SOURCE_COLORS[ann.source],
  }));
}

/**
 * Default filter state for the dataset viewer.
 */
export const DEFAULT_FILTERS: DatasetFilters = {
  sources: [
    "user_click",
    "smart_click_analysis",
    "template_matching",
    "manual",
  ],
  confidence_min: 0,
  confidence_max: 1,
  review_statuses: ["pending", "approved", "rejected", "flagged"],
  page: 1,
  page_size: 24,
};
