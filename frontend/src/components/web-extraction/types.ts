/**
 * TypeScript types for web extraction feature.
 */

// Bounding box for elements and states
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Element types that can be detected
export type ElementType =
  | "button"
  | "text_input"
  | "password_input"
  | "textarea"
  | "link"
  | "dropdown"
  | "checkbox"
  | "radio"
  | "slider"
  | "toggle"
  | "tab"
  | "menu_item"
  | "icon_button"
  | "image"
  | "label"
  | "heading"
  | "paragraph"
  | "list_item"
  | "table_cell"
  | "unknown";

// State/region types
export type StateType =
  | "navigation"
  | "menu"
  | "dropdown_menu"
  | "dialog"
  | "modal"
  | "sidebar"
  | "toolbar"
  | "form"
  | "card"
  | "panel"
  | "toast"
  | "tooltip"
  | "popover"
  | "header"
  | "footer"
  | "content"
  | "unknown";

// Extracted element
export interface ExtractedElement {
  id: string;
  bbox: BoundingBox;
  elementType: ElementType;
  textContent: string | null;
  placeholder: string | null;
  selector: string;
  isInteractive: boolean;
  isEnabled: boolean;
  isVisible: boolean;
  semanticRole: string | null;
  ariaLabel: string | null;
  name: string | null;
}

// Extracted state/region
export interface ExtractedState {
  id: string;
  name: string;
  bbox: BoundingBox;
  stateType: StateType;
  elementIds: string[];
  screenshotId: string;
  detectionMethod: string;
  confidence: number;
  semanticRole: string | null;
  ariaLabel: string | null;
  sourceUrl: string;
}

// Extracted transition
export interface ExtractedTransition {
  id: string;
  actionType: string;
  targetElementId: string;
  targetSelector: string;
  causesAppear: string[];
  causesDisappear: string[];
}

// Extraction configuration
export interface ExtractionConfig {
  urls: string[];
  viewports: [number, number][];
  captureHoverStates: boolean;
  captureFocusStates: boolean;
  maxDepth: number;
  maxPages: number;
  authCookies: Record<string, string>;
}

// Extraction session from backend
export interface ExtractionSession {
  id: string;
  projectId: string;
  sourceUrls: string[];
  config: ExtractionConfig;
  status: "pending" | "running" | "completed" | "failed";
  stats: ExtractionStats;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// Extraction statistics
export interface ExtractionStats {
  pagesVisited: number;
  statesFound: number;
  elementsFound: number;
  transitionsFound: number;
}

// Screenshot data
export interface ScreenshotData {
  id: string;
  thumbnail: string; // base64
  fullResolution?: string; // base64, loaded on demand
}

// WebSocket message types
export interface ExtractionProgressMessage {
  type: "extraction_progress";
  data: {
    status: "running" | "paused" | "complete" | "error";
    currentUrl: string;
    pagesVisited: number;
    statesFound: number;
    elementsFound: number;
    transitionsFound: number;
  };
}

export interface StateDetectedMessage {
  type: "state_detected";
  data: {
    state: ExtractedState;
    thumbnail: string;
  };
}

export interface ElementDetectedMessage {
  type: "element_detected";
  data: {
    element: ExtractedElement;
  };
}

export interface ExtractionCompleteMessage {
  type: "extraction_complete";
  data: {
    extractionId: string;
    summary: ExtractionStats;
  };
}

export type ExtractionMessage =
  | ExtractionProgressMessage
  | StateDetectedMessage
  | ElementDetectedMessage
  | ExtractionCompleteMessage;
