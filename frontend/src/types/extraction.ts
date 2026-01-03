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
