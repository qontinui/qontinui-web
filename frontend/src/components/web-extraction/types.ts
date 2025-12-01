/**
 * TypeScript types for web extraction feature.
 *
 * These types align with the qontinui extraction architecture:
 * - StateStructure: Unified model for any collection of states/transitions
 *   (may contain disjoint state trees from multiple apps or features)
 * - Origin tracking enables partial replacement during re-extraction
 */

// =============================================================================
// Core Types
// =============================================================================

// Bounding box for elements and states
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Viewport dimensions
export interface Viewport {
  width: number;
  height: number;
  scaleFactor?: number;
}

// Screenshot reference
export interface Screenshot {
  id: string;
  path: string;
  viewport: Viewport;
  thumbnailPath?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Element Types
// =============================================================================

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

// =============================================================================
// State Types
// =============================================================================

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
  | "page"
  | "component"
  | "unknown";

// Evidence types for state correlation
export type EvidenceType =
  | "element_match"
  | "test_id_match"
  | "class_name_match"
  | "text_content_match"
  | "aria_match"
  | "name_match"
  | "selector_match"
  | "structural_match"
  | "state_variable_match"
  | "conditional_match"
  | "runtime_verified"
  | "event_handler_match"
  | "route_match"
  | "timing_match";

// Matching evidence for correlation
export interface MatchingEvidence {
  evidenceType: EvidenceType;
  description: string;
  strength: number;
  sourceFile?: string;
  sourceLine?: number;
  runtimeStateId?: string;
  runtimeElementId?: string;
  staticReference?: string;
  runtimeReference?: string;
  metadata?: Record<string, unknown>;
}

// Correlated state (from static + runtime analysis)
export interface CorrelatedState {
  id: string;
  name: string;
  // Static analysis source
  sourceComponent?: string;
  controllingVariables?: string[];
  conditions?: string[];
  sourceFile?: string;
  sourceLine?: number;
  // Runtime extraction
  screenshot?: Screenshot;
  boundingBox?: BoundingBox;
  elements?: string[];
  route?: string;
  // Classification
  stateType: StateType;
  // Confidence and evidence
  confidence: number;
  matchEvidence?: MatchingEvidence[];
  metadata?: Record<string, unknown>;
}

// Legacy extracted state (for backward compatibility during migration)
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

// =============================================================================
// Transition Types
// =============================================================================

// Inferred transition (from static analysis)
export interface InferredTransition {
  id: string;
  triggerHandler: string;
  stateBefore?: string;
  stateAfter?: string;
  causesAppear?: string[];
  causesDisappear?: string[];
  confidence: number;
  sourceFile?: string;
  sourceLine?: number;
  metadata?: Record<string, unknown>;
}

// Verified transition (confirmed by runtime)
export interface VerifiedTransition {
  id: string;
  inferred?: string;
  observed?: string;
  verified: boolean;
  verificationMethod: string;
  actionType: string;
  triggerElement?: string;
  triggerSelector?: string;
  causesAppear?: string[];
  causesDisappear?: string[];
  confidence: number;
  discrepancies?: Array<{
    discrepancyType: string;
    description: string;
    expected?: unknown;
    actual?: unknown;
  }>;
  sourceFile?: string;
  sourceLine?: number;
  metadata?: Record<string, unknown>;
}

// Legacy extracted transition
export interface ExtractedTransition {
  id: string;
  actionType: string;
  targetElementId: string;
  targetSelector: string;
  causesAppear: string[];
  causesDisappear: string[];
}

// =============================================================================
// Framework and Mode Types
// =============================================================================

// Supported frameworks
export type FrameworkType =
  | "react"
  | "next"
  | "remix"
  | "vue"
  | "nuxt"
  | "svelte"
  | "svelte_kit"
  | "angular"
  | "solid"
  | "astro"
  | "electron"
  | "tauri"
  | "flutter"
  | "react_native"
  | "web"
  | "desktop"
  | "mobile"
  | "unknown";

// Extraction modes
export type ExtractionMode = "static_only" | "black_box" | "white_box";

// =============================================================================
// State Structure (unified model)
// =============================================================================

/**
 * A collection of states and transitions forming one or more state graphs.
 *
 * A StateStructure may contain:
 * - A single connected state graph (typical single-app extraction)
 * - Multiple disjoint state graphs (multi-app environment, or app with separate features)
 * - Any combination of connected and disjoint states
 *
 * The structure tracks:
 * - All states (which may form disjoint trees)
 * - All transitions (which only connect states within the same tree)
 * - Currently active states (can span multiple trees simultaneously)
 * - Origin of each state/transition/element (for replacement during re-extraction)
 */
export interface StateStructure {
  id: string;
  name: string;

  // Core state data
  states: CorrelatedState[];
  transitions: (InferredTransition | VerifiedTransition)[];
  elements: ExtractedElement[];
  screenshots: Record<string, Screenshot>;

  // Active state tracking
  activeStateIds: string[];

  // Origin tracking for replacement operations
  // Maps item_id -> source_id (e.g., app ID, feature ID)
  stateOrigins: Record<string, string>;
  transitionOrigins: Record<string, string>;
  elementOrigins: Record<string, string>;

  // Environment info
  viewport: Viewport;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Backward Compatibility Aliases
// =============================================================================

/**
 * @deprecated Use StateStructure instead. ApplicationStateStructure is an alias
 * for backward compatibility.
 */
export type ApplicationStateStructure = StateStructure;

/**
 * @deprecated Use StateStructure instead. CompositeStateStructure is an alias
 * for backward compatibility.
 */
export type CompositeStateStructure = StateStructure;

// =============================================================================
// Extraction Configuration
// =============================================================================

export interface ExtractionTarget {
  projectPath?: string;
  url?: string;
  executablePath?: string;
  appId?: string;
  framework?: FrameworkType;
  authCookies?: Record<string, string>;
  authHeaders?: Record<string, string>;
  loginUrl?: string;
}

export interface ExtractionConfig {
  urls: string[];
  viewports: [number, number][];
  captureHoverStates: boolean;
  captureFocusStates: boolean;
  captureScrollStates?: boolean;
  maxDepth: number;
  maxPages: number;
  authCookies: Record<string, string>;
  // New architecture fields
  target?: ExtractionTarget;
  mode?: ExtractionMode;
  projectPath?: string;
  correlationThreshold?: number;
  parallelWorkers?: number;
  timeoutSeconds?: number;
}

// =============================================================================
// Extraction Results
// =============================================================================

export interface StaticAnalysisResult {
  framework: FrameworkType;
  components: unknown[];
  routes: unknown[];
  stateDefinitions: unknown[];
  eventHandlers: unknown[];
  navigationFlows: unknown[];
  analyzedFiles: number;
  analysisDurationMs: number;
  errors: string[];
  warnings: string[];
}

export interface RuntimeExtractionResult {
  elements: ExtractedElement[];
  states: CorrelatedState[];
  transitions: (InferredTransition | VerifiedTransition)[];
  screenshots: string[];
  pagesVisited: number;
  extractionDurationMs: number;
  errors: string[];
}

export interface ExtractionResult {
  extractionId: string;
  mode: ExtractionMode;
  framework: FrameworkType;
  staticAnalysis?: StaticAnalysisResult;
  runtimeExtraction?: RuntimeExtractionResult;
  inferredStates?: CorrelatedState[];
  inferredTransitions?: InferredTransition[];
  correlatedStates: CorrelatedState[];
  verifiedTransitions: VerifiedTransition[];
  startedAt: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Session and Stats
// =============================================================================

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
  // New architecture fields
  mode?: ExtractionMode;
  framework?: FrameworkType;
  applicationState?: ApplicationStateStructure;
  compositeState?: CompositeStateStructure;
}

export interface ExtractionStats {
  pagesVisited: number;
  statesFound: number;
  elementsFound: number;
  transitionsFound: number;
}

// Screenshot data for UI display
export interface ScreenshotData {
  id: string;
  thumbnail: string; // base64
  fullResolution?: string; // base64, loaded on demand
}

// =============================================================================
// WebSocket Message Types
// =============================================================================

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
    state: ExtractedState | CorrelatedState;
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
    // New architecture fields
    applicationState?: ApplicationStateStructure;
    compositeState?: CompositeStateStructure;
  };
}

export type ExtractionMessage =
  | ExtractionProgressMessage
  | StateDetectedMessage
  | ElementDetectedMessage
  | ExtractionCompleteMessage;

// =============================================================================
// Multi-App Extraction Types
// =============================================================================

export interface MultiAppExtractionConfig {
  name: string;
  applications: Array<{
    appId: string;
    appName: string;
    config: ExtractionConfig;
  }>;
  viewport?: Viewport;
}

export interface MultiAppExtractionSession extends ExtractionSession {
  compositeId: string;
  applicationSessions: Record<string, ExtractionSession>;
}
