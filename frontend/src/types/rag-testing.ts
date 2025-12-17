/**
 * Types for RAG Testing page
 *
 * Used for testing RAG element matching with SAM3 segmentation and CLIP embeddings.
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface RAGFindRequest {
  screenshot_base64: string;
  element_ids?: string[];
  similarity_threshold?: number;
  matching_strategy?: "average" | "any_match";
  use_ocr?: boolean;
  return_segments?: boolean;
  max_results?: number;
}

export interface RAGFindMatch {
  element_id: string;
  element_name: string;
  text_description: string | null;
  visual_similarity: number;
  text_similarity: number | null;
  ocr_similarity: number | null;
  ocr_text: string | null;
  bounding_box: BoundingBox;
  score: number;
}

export interface RAGFindSegment {
  id: string;
  bbox: BoundingBox;
  mask_data: string | null; // Base64 encoded PNG mask
  mask_density: number;
  text_description: string | null;
}

export interface RAGFindResponse {
  success: boolean;
  matches: RAGFindMatch[];
  segments: RAGFindSegment[] | null;
  processing_time_ms: number;
  segment_count: number;
  error: string | null;
}

// ============================================================================
// UI State Types
// ============================================================================

export interface SegmentWithMatches extends RAGFindSegment {
  matches: RAGFindMatch[];
  bestMatch: RAGFindMatch | null;
}

export type SearchMode = "filtered" | "specific";

export type MatchingStrategy = "average" | "any_match";

export interface SearchFilters {
  elementTypes: string[];
  states: string[];
  textQuery: string;
}

export interface DisplayOptions {
  showBoundingBoxes: boolean;
  showMasks: boolean;
  showLabels: boolean;
  highlightMatches: boolean;
}

export interface CanvasState {
  zoom: number;
  panOffset: { x: number; y: number };
}
