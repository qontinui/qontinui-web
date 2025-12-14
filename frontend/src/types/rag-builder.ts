/**
 * TypeScript types for RAG Element Builder
 *
 * These types match the RAGElement schema from qontinui-schemas
 */

// ============================================================================
// Matching Strategies
// ============================================================================

export enum MatchingStrategy {
  AVERAGE = "average", // Default: Average all vectors into one query
  ANY_MATCH = "any_match", // Match if ANY pattern exceeds threshold
}

// ============================================================================
// OCR Types
// ============================================================================

export enum OCRMatchMode {
  EXACT = "exact", // Exact string match
  CONTAINS = "contains", // Text contains the query
  REGEX = "regex", // Regular expression match
}

export interface OCRFilter {
  text: string | null;
  match_mode: OCRMatchMode;
  similarity: number; // Fuzzy matching threshold (Levenshtein ratio)
}

export interface OCRConfig {
  enabled: boolean;
  weight: number; // Weight in combined score (0.0-1.0)
  as_filter: boolean; // True = must match, False = just affects score
  filter_threshold: number; // Minimum OCR similarity to pass filter
}

// ============================================================================
// Image with Mask
// ============================================================================

export interface RAGImage {
  id: string;
  pixel_data: string | null; // Base64 encoded image data (or S3 key)
  s3_key: string | null; // S3 object key for storage
  mask_data: string | null; // Base64 encoded mask (0/1 or 0.0-1.0)
  mask_density: number; // Percentage of active pixels in mask
  width: number;
  height: number;
  image_embedding: number[] | null; // CLIP 512-dim embedding
}

// ============================================================================
// Element Types
// ============================================================================

export enum ElementType {
  // Button types
  BUTTON = "button",
  ICON_BUTTON = "icon_button",
  TOGGLE_BUTTON = "toggle_button",
  DROPDOWN_BUTTON = "dropdown_button",

  // Input types
  TEXT_INPUT = "text_input",
  SEARCH_INPUT = "search_input",
  PASSWORD_INPUT = "password_input",
  TEXTAREA = "textarea",

  // Selection types
  CHECKBOX = "checkbox",
  RADIO_BUTTON = "radio_button",
  DROPDOWN = "dropdown",
  COMBOBOX = "combobox",
  SLIDER = "slider",

  // Navigation types
  LINK = "link",
  TAB = "tab",
  MENU_ITEM = "menu_item",
  BREADCRUMB = "breadcrumb",

  // Container types
  MODAL = "modal",
  DIALOG = "dialog",
  PANEL = "panel",
  CARD = "card",

  // Display types
  ICON = "icon",
  IMAGE = "image",
  LABEL = "label",
  BADGE = "badge",
  TOOLTIP = "tooltip",

  // Data display types
  TABLE_CELL = "table_cell",
  TABLE_HEADER = "table_header",
  LIST_ITEM = "list_item",

  // Feedback types
  PROGRESS = "progress",
  SPINNER = "spinner",

  // Unknown
  UNKNOWN = "unknown",
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RAGElement {
  // Identity
  id: string;
  created_at: string;
  updated_at: string;

  // Source Information
  source_app: string;
  source_state_id: string | null;
  source_screenshot_id: string | null;
  extraction_method: string;

  // Geometry
  bounding_box: BoundingBox | null;
  width: number;
  height: number;
  aspect_ratio: number;
  area: number;
  position_quadrant: string;

  // Visual Features
  dominant_colors: Array<[number, number, number]>;
  color_histogram: number[];
  average_brightness: number;
  contrast_ratio: number;
  edge_density: number;

  // Text Content
  has_text: boolean;
  ocr_text: string;
  ocr_confidence: number;
  text_length: number;

  // Classification
  element_type: ElementType;
  element_subtype: string;
  is_interactive: boolean;
  interaction_type: string;

  // State Indicators
  visual_state: string;
  is_enabled: boolean;
  is_selected: boolean;
  is_focused: boolean;

  // Context
  parent_region: string | null;
  depth_in_hierarchy: number;
  sibling_count: number;

  // Platform
  platform: string;

  // Images with Masks (REQUIRED - at least one image)
  images: RAGImage[];

  // Aggregated Embeddings (computed from all images)
  aggregated_image_embedding: number[] | null;
  aggregated_text_embedding: number[] | null;

  // Legacy Embeddings (for backward compatibility)
  text_embedding: number[] | null;
  text_description: string; // Optional - AI can generate from images
  image_embedding: number[] | null;

  // Matching Configuration
  matching_strategy: MatchingStrategy | null; // null = use project default
  ocr_filter: OCRFilter | null;
  ocr_config: OCRConfig | null;
  expected_text: string | null;

  // State Machine Integration
  state_id: string | null;
  state_name: string;
  is_defining_element: boolean;
  /**
   * @deprecated Use is_defining_element instead. Elements are optional if is_defining_element is false.
   * This field will be removed in a future version.
   */
  is_optional_element: boolean;
  similarity_threshold: number | null; // null = use project default from recognition settings
  /**
   * When true, the element is expected to appear at a fixed screen position.
   * Uses bounding box coordinates for faster matching.
   */
  fixed_location: boolean;
  /**
   * @deprecated Use fixed_location instead.
   */
  is_fixed_position: boolean;
  is_shared: boolean;
  probability: number;
  search_region_id: string | null;

  // Cross-Application Semantics
  semantic_role: string;
  semantic_action: string;
  style_family: string;
}

export type RAGElementFormData = Partial<RAGElement>;
