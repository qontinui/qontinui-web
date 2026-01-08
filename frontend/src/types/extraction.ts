/**
 * Auto-generated TypeScript types from qontinui-schemas
 * DO NOT EDIT - regenerate with: poetry run python scripts/generate_typescript.py
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export enum ExtractionStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum StateType {
  PAGE = "page",
  NAVIGATION = "navigation",
  HEADER = "header",
  FOOTER = "footer",
  SIDEBAR = "sidebar",
  MAIN = "main",
  MODAL = "modal",
  DIALOG = "dialog",
  FORM = "form",
  CARD = "card",
  LIST = "list",
  TABLE = "table",
  MENU = "menu",
  TOOLBAR = "toolbar",
  TAB_PANEL = "tab_panel",
  ACCORDION = "accordion",
  CAROUSEL = "carousel",
  ALERT = "alert",
  TOAST = "toast",
  TOOLTIP = "tooltip",
  POPOVER = "popover",
  DROPDOWN = "dropdown",
  UNKNOWN = "unknown",
}

export enum TriggerType {
  CLICK = "click",
  HOVER = "hover",
  FOCUS = "focus",
  SCROLL = "scroll",
  NAVIGATION = "navigation",
  KEYBOARD = "keyboard",
  STATE_CHANGE = "state_change",
  UNKNOWN = "unknown",
}

export interface BoundingBox {
  /** X coordinate of top-left corner */
  x: number;
  /** Y coordinate of top-left corner */
  y: number;
  /** Width of the bounding box */
  width: number;
  /** Height of the bounding box */
  height: number;
}

export interface ExtractedElement {
  /** Unique identifier for the element */
  id: string;
  /** HTML tag name (e.g., 'button', 'a', 'input') */
  tag_name: string;
  /** Semantic type (e.g., 'button', 'link', 'input') */
  element_type: string;
  /** Text content of the element */
  text?: string | null;
  /** Bounding box of the element */
  bbox: BoundingBox;
  /** CSS selector for the element */
  selector?: string | null;
  /** HTML attributes of the element */
  attributes?: Record<string, any>;
  /** Whether the element is interactive */
  is_interactive?: boolean;
  /** Confidence score for element detection */
  confidence?: number;
}

export interface ElementAnnotation {
  /** Unique identifier */
  id: string;
  /** Human-readable name for the element (OCR-based or derived) */
  name?: string | null;
  /** Type of element */
  element_type: string;
  /** Bounding box */
  bbox: BoundingBox;
  /** Text content */
  text?: string | null;
  /** CSS selector */
  selector?: string | null;
  confidence?: number;
}

export interface StateAnnotation {
  /** Unique identifier for the state */
  id: string;
  /** Human-readable name for the state */
  name: string;
  /** Bounding box of the state region */
  bbox: BoundingBox;
  /** Semantic type of the state */
  state_type?: StateType | string;
  /** IDs of elements contained in this state */
  element_ids?: string[];
  /** ID of the screenshot showing this state */
  screenshot_id?: string | null;
  /** URL where this state was discovered */
  source_url?: string | null;
  /** How the state was detected (semantic, heuristic, etc.) */
  detection_method?: string | null;
  /** Confidence score for state detection */
  confidence?: number;
  /** Additional metadata about the state */
  metadata?: Record<string, any>;
}

export interface InferredTransition {
  /** Unique identifier for the transition */
  id: string;
  /** ID of the source state */
  from_state_id: string;
  /** ID of the target state */
  to_state_id: string;
  /** Type of trigger that causes the transition */
  trigger_type?: TriggerType | string;
  /** CSS selector of the trigger element */
  trigger_selector?: string | null;
  /** Text of the trigger element (for non-image triggers) */
  trigger_text?: string | null;
  /** Image URL of the trigger element (for image triggers) */
  trigger_image?: string | null;
  /** Whether the trigger is an image link */
  has_image?: boolean;
  /** URL of the source page */
  source_url?: string | null;
  /** URL of the target page */
  target_url?: string | null;
  /** Confidence score for transition detection */
  confidence?: number;
  /** Additional metadata about the transition */
  metadata?: Record<string, any>;
}

export interface ExtractionStats {
  /** Number of pages crawled */
  pages_extracted?: number;
  /** Number of elements discovered */
  elements_found?: number;
  /** Number of states discovered */
  states_found?: number;
  /** Number of transitions discovered */
  transitions_found?: number;
  /** Extraction ID where screenshots are stored */
  screenshot_extraction_id?: string | null;
}

/** Vision extraction results from runner */
export interface VisionResults {
  /** Extraction ID */
  extraction_id?: string;
  /** Processing duration in milliseconds */
  duration_ms?: number;
  /** List of techniques that were run */
  techniques_run?: string[];
  /** Edge detection results */
  edge_results?: Array<{
    id: string;
    bbox: { x: number; y: number; width: number; height: number };
    contour_area: number;
    vertex_count: number;
    aspect_ratio: number;
    contour_points?: number[][];
  }>;
  /** SAM3 segmentation results */
  sam3_results?: Array<{
    id: string;
    bbox: { x: number; y: number; width: number; height: number };
    mask_area: number;
    stability_score: number;
    predicted_iou: number;
  }>;
  /** OCR results */
  ocr_results?: Array<{
    id: string;
    text: string;
    bbox: { x: number; y: number; width: number; height: number };
    confidence: number;
    language: string;
  }>;
  /** Merged candidate elements */
  merged_candidates?: Array<Record<string, unknown>>;
  /** Base64 encoded edge detection overlay */
  edge_overlay?: string | null;
  /** Base64 encoded SAM3 segmentation overlay */
  sam3_overlay?: string | null;
  /** Base64 encoded OCR overlay */
  ocr_overlay?: string | null;
}

export interface ExtractionAnnotation {
  /** Unique identifier */
  id: string;
  /** ID of the parent extraction session */
  session_id: string;
  /** ID of the screenshot for this annotation */
  screenshot_id: string;
  /** URL of the page */
  source_url: string;
  /** Viewport width when screenshot was taken */
  viewport_width: number;
  /** Viewport height when screenshot was taken */
  viewport_height: number;
  /** Elements discovered on this page */
  elements?: ElementAnnotation[];
  /** States discovered on this page */
  states?: StateAnnotation[];
  /** Vision extraction results (Edge, SAM3, OCR) from runner */
  vision_results?: VisionResults | null;
  /** When this annotation was created */
  created_at?: string | null;
  /** When this annotation was last updated */
  updated_at?: string | null;
}

export interface ExtractionSessionConfig {
  /** Viewport sizes to use for extraction */
  viewports?: any[];
  /** Whether to capture hover states */
  capture_hover_states?: boolean;
  /** Whether to capture focus states */
  capture_focus_states?: boolean;
  /** Maximum crawl depth */
  max_depth?: number;
  /** Maximum number of pages to crawl */
  max_pages?: number;
  /** Authentication cookies for the target site */
  auth_cookies?: Record<string, any> | null;
}

/** Pre-built state machine from runner (co-occurrence clustering result) */
export interface StateMachine {
  /** States with stateImages, searchRegions, fixed flags */
  states: StateMachineState[];
  /** Transitions derived from navigation actions */
  transitions: StateMachineTransition[];
}

/** State in the state machine (workflow format) */
export interface StateMachineState {
  id: string;
  name: string;
  description: string;
  stateImages: StateMachineStateImage[];
  regions: never[]; // Always empty for extraction
  locations: never[]; // Always empty for extraction
  strings: never[]; // Always empty for extraction
  position: { x: number; y: number };
  initial?: boolean;
  isFinal?: boolean;
}

/** StateImage in the state machine */
export interface StateMachineStateImage {
  id: string;
  name: string;
  patterns: StateMachinePattern[];
  shared: boolean;
  searchRegions: BoundingBox[];
  /** Direct bounding box for the element (from interactive element extraction) */
  bbox?: BoundingBox;
  /** Screenshot ID where this image was detected (for filtering annotations) */
  screenshotId?: string;
  /** Source URL where this image was detected */
  sourceUrl?: string;
  /** Why this element was extracted (debugging) - e.g., 'interactive_tag:button', 'leaf_text:span' */
  extractionCategory?: string;
}

/** Pattern in a StateImage */
export interface StateMachinePattern {
  id: string;
  name?: string;
  searchRegions: BoundingBox[];
  fixed: boolean;
}

/** Transition in the state machine */
export interface StateMachineTransition {
  id: string;
  type: string;
  fromState?: string;
  toState?: string;
  workflows: string[];
  timeout: number;
  retryCount: number;
}

export interface ExtractionSession {
  /** Unique identifier for the session */
  id: string;
  /** ID of the project this extraction belongs to */
  project_id: string;
  /** URLs to extract from */
  source_urls: string[];
  /** Extraction configuration */
  config: ExtractionSessionConfig | Record<string, any>;
  /** Current status of the extraction */
  status: ExtractionStatus | string;
  /** Extraction statistics */
  stats: ExtractionStats | Record<string, any>;
  /** Error message if extraction failed */
  error_message?: string | null;
  /** Pre-built state machine from runner */
  state_machine?: StateMachine | null;
  /** When the session was created */
  created_at: string | string;
  /** When extraction started */
  started_at?: string | string | null;
  /** When extraction completed */
  completed_at?: string | string | null;
  /** User who created the session */
  created_by?: string | null;
}

export interface ExtractionSessionDetail {
  /** Unique identifier for the session */
  id: string;
  /** ID of the project this extraction belongs to */
  project_id: string;
  /** URLs to extract from */
  source_urls: string[];
  /** Extraction configuration */
  config: ExtractionSessionConfig | Record<string, any>;
  /** Current status of the extraction */
  status: ExtractionStatus | string;
  /** Extraction statistics */
  stats: ExtractionStats | Record<string, any>;
  /** Error message if extraction failed */
  error_message?: string | null;
  /** Pre-built state machine from runner */
  state_machine?: StateMachine | null;
  /** When the session was created */
  created_at: string | string;
  /** When extraction started */
  started_at?: string | string | null;
  /** When extraction completed */
  completed_at?: string | string | null;
  /** User who created the session */
  created_by?: string | null;
  /** Page annotations with states and elements */
  annotations?: ExtractionAnnotation[];
  /** Transitions discovered during extraction */
  transitions?: InferredTransition[];
}

export interface StateImportRequest {
  /** Specific state IDs to import (None = all) */
  state_ids?: string[] | null;
  /** Workflow to add states to */
  target_workflow_id?: string | null;
}

export interface ImportResult {
  /** Number of states imported */
  imported_states: number;
  /** Number of transitions imported */
  imported_transitions: number;
  /** ID of the workflow states were added to */
  workflow_id?: string | null;
}

// =============================================================================
// Playwright State Collector Types
// =============================================================================

export enum PlaywrightRiskLevel {
  SAFE = "safe",
  CAUTION = "caution",
  DANGEROUS = "dangerous",
  BLOCKED = "blocked",
}

export enum PlaywrightExtractionStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
}

export interface PlaywrightSafetyConfig {
  /** Keywords that indicate dangerous actions */
  dangerous_keywords: string[];
  /** Keywords that indicate safe navigation */
  safe_keywords: string[];
  /** CSS selectors to always block */
  blocked_selectors: string[];
  /** CSS selectors that are always safe */
  safe_selectors: string[];
  /** Maximum risk level to auto-click */
  max_risk_level: PlaywrightRiskLevel;
  /** Dry run mode - identify but don't click */
  dry_run: boolean;
}

export interface PlaywrightExtractionRequest {
  /** Starting URL to extract from */
  url: string;
  /** How many clicks deep to explore */
  max_depth: number;
  /** Maximum elements to extract per page */
  max_elements_per_page: number;
  /** Maximum risk level to auto-click */
  max_risk_level: "safe" | "caution";
  /** If true, identify elements without clicking */
  dry_run: boolean;
  /** Additional dangerous keywords to block */
  additional_blocked_keywords: string[];
  /** Additional safe keywords to allow */
  additional_safe_keywords: string[];
  /** Additional CSS selectors to block */
  blocked_selectors: string[];
  /** Verify extracted images are detectable */
  verify_extractions: boolean;
  /** Minimum similarity for verification */
  verification_threshold: number;
}

export interface PlaywrightExtractedClickable {
  /** Unique element ID */
  element_id: string;
  /** CSS selector */
  selector: string;
  /** HTML tag name */
  tag_name: string;
  /** Text content */
  text: string | null;
  /** ARIA label */
  aria_label: string | null;
  /** Bounding box */
  bounding_box: BoundingBox;
  /** Risk level for this element */
  risk_level: string;
  /** Reason for risk classification */
  risk_reason: string;
  /** Whether the element was clicked */
  was_clicked: boolean;
  /** Whether pattern matching verified this element */
  is_verified: boolean;
  /** Pattern matching confidence score */
  match_confidence: number;
  /** Base64 encoded screenshot of the element */
  screenshot_base64?: string | null;
  /** Error message if extraction failed */
  error?: string | null;
}

export interface PlaywrightSkippedElement {
  /** CSS selector */
  selector: string;
  /** Text content */
  text: string | null;
  /** Risk level */
  risk: string;
  /** Reason for skipping */
  reason: string;
  /** URL where element was found */
  url: string;
}

export interface PlaywrightExtractionMetrics {
  /** Total elements found */
  total_found: number;
  /** Elements that were clicked */
  clicked: number;
  /** Elements skipped due to safety rules */
  skipped_dangerous: number;
  /** Pages visited during extraction */
  pages_visited: number;
  /** Number of errors encountered */
  errors: number;
  /** Elements verified by pattern matching */
  verified?: number;
  /** Elements that failed verification */
  failed?: number;
  /** Average pattern matching confidence */
  avg_confidence?: number;
  /** Verification success rate */
  verification_rate?: number;
}

export interface PlaywrightExtractionJob {
  /** Job ID */
  job_id: string;
  /** Current status */
  status: PlaywrightExtractionStatus;
  /** Progress information */
  progress: {
    stage: string;
    percent: number;
  } | null;
  /** Result when completed */
  result: {
    clickables: PlaywrightExtractedClickable[];
    skipped_dangerous: PlaywrightSkippedElement[];
    metrics: PlaywrightExtractionMetrics;
    pages_visited: string[];
    errors: string[];
  } | null;
  /** Error message if failed */
  error: string | null;
}
