/**
 * Unified Extraction Types
 *
 * Provides a common interface for all extraction methods:
 * - Vision extraction (Edge, SAM3, OCR)
 * - Playwright extraction (interactive web crawling)
 * - Pattern matching (template matching)
 * - Web extraction (full page extraction with state discovery)
 *
 * These types enable a single status tracking system and consistent UI components.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Universal bounding box format used across all extraction methods.
 */
export interface UnifiedBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Extraction method types.
 */
export type ExtractionMethod =
  | "vision"
  | "playwright"
  | "pattern"
  | "web"
  | "composite";

/**
 * Status values consistent across all extraction types.
 */
export type ExtractionStatus =
  | "idle"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Risk levels for interactive extraction (Playwright).
 */
export type RiskLevel = "safe" | "caution" | "dangerous" | "blocked";

// ============================================================================
// Unified Extracted Element
// ============================================================================

/**
 * A unified element representation that can hold results from any extraction method.
 * All fields are optional to accommodate different extraction techniques.
 */
export interface UnifiedElement {
  /** Unique identifier for the element */
  id: string;

  /** Bounding box in screen coordinates */
  bbox: UnifiedBoundingBox;

  /** Confidence score (0.0 to 1.0) */
  confidence: number;

  /** Detection technique that found this element */
  detectionMethod: ExtractionMethod | string;

  // --- Common fields ---

  /** Human-readable name or label */
  name?: string;

  /** Element category (button, input, link, icon, container, text, etc.) */
  category?: string;

  /** Text content if available */
  text?: string;

  /** Whether this element is interactive/clickable */
  isInteractive?: boolean;

  // --- DOM-based fields (Playwright, Web) ---

  /** CSS selector for the element */
  selector?: string;

  /** HTML tag name */
  tagName?: string;

  /** ARIA label if present */
  ariaLabel?: string;

  /** HTML attributes */
  attributes?: Record<string, string>;

  // --- Vision-based fields ---

  /** Contour area for edge detection */
  contourArea?: number;

  /** Vertex count for edge detection */
  vertexCount?: number;

  /** Aspect ratio (width/height) */
  aspectRatio?: number;

  /** Mask area for segmentation */
  maskArea?: number;

  /** Stability score for SAM3 */
  stabilityScore?: number;

  /** Predicted IoU for SAM3 */
  predictedIou?: number;

  /** OCR language detected */
  language?: string;

  // --- Safety fields (Playwright) ---

  /** Risk level for interactive elements */
  riskLevel?: RiskLevel;

  /** Reason for risk classification */
  riskReason?: string;

  /** Whether the element was clicked during extraction */
  wasClicked?: boolean;

  /** Whether the element was verified via pattern matching */
  verified?: boolean;

  /** Verification confidence score */
  verificationConfidence?: number;

  // --- Pattern matching fields ---

  /** Similarity score for pattern matching */
  similarity?: number;

  /** Center point coordinates */
  center?: { x: number; y: number };

  // --- Source information ---

  /** URL where element was found */
  sourceUrl?: string;

  /** Screenshot ID associated with this element */
  screenshotId?: string;

  /** Base64 encoded element screenshot */
  screenshot?: string;

  // --- Metadata ---

  /** Additional technique-specific data */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Unified Extraction Result
// ============================================================================

/**
 * Unified extraction result that can represent any extraction method's output.
 */
export interface UnifiedExtractionResult {
  /** Unique identifier for this extraction job */
  jobId: string;

  /** Primary extraction method used */
  method: ExtractionMethod;

  /** Current status */
  status: ExtractionStatus;

  /** Techniques run (e.g., ["edge", "sam3", "ocr"]) */
  techniquesRun: string[];

  /** Start timestamp (ISO 8601) */
  startedAt: string;

  /** Completion timestamp (ISO 8601) */
  completedAt?: string;

  /** Processing duration in milliseconds */
  durationMs?: number;

  // --- Image information ---

  /** Source image width */
  imageWidth?: number;

  /** Source image height */
  imageHeight?: number;

  /** Source URL or file path */
  source?: string;

  // --- Results ---

  /** Extracted elements */
  elements: UnifiedElement[];

  /** Raw technique-specific results (for advanced use) */
  rawResults?: {
    edge?: unknown[];
    sam3?: unknown[];
    ocr?: unknown[];
    playwright?: unknown[];
    pattern?: unknown[];
  };

  /** Overlay images (base64 encoded) */
  overlays?: {
    edge?: string;
    sam3?: string;
    ocr?: string;
    combined?: string;
  };

  // --- Metrics ---

  /** Extraction metrics/statistics */
  metrics?: UnifiedExtractionMetrics;

  // --- Error handling ---

  /** Error message if failed */
  error?: string;

  /** Detailed error information */
  errorDetails?: Record<string, unknown>;

  // --- Session tracking ---

  /** Client session ID (for multi-session support) */
  sessionId?: string;

  /** Project ID if associated with a project */
  projectId?: string;
}

/**
 * Unified metrics for extraction operations.
 */
export interface UnifiedExtractionMetrics {
  /** Total elements found */
  totalFound: number;

  /** Elements by category */
  byCategory?: Record<string, number>;

  /** Elements by technique */
  byTechnique?: Record<string, number>;

  // --- Playwright-specific ---

  /** Number of elements clicked */
  clicked?: number;

  /** Number of dangerous elements skipped */
  skippedDangerous?: number;

  /** Number of pages visited */
  pagesVisited?: number;

  /** Number of elements verified */
  verified?: number;

  /** Verification rate (0.0 to 1.0) */
  verificationRate?: number;

  /** Average confidence score */
  avgConfidence?: number;

  // --- Error tracking ---

  /** Number of errors encountered */
  errors?: number;

  /** Error messages */
  errorMessages?: string[];
}

// ============================================================================
// Unified Progress
// ============================================================================

/**
 * Progress information for long-running extractions.
 */
export interface UnifiedExtractionProgress {
  /** Job ID */
  jobId: string;

  /** Current status */
  status: ExtractionStatus;

  /** Progress percentage (0-100) */
  percent: number;

  /** Human-readable progress message */
  message: string;

  /** Current phase of extraction */
  phase?: string;

  /** Phase-specific progress (0-100) */
  phasePercent?: number;

  // --- Running statistics ---

  /** Current URL being processed */
  currentUrl?: string;

  /** Pages visited so far */
  pagesVisited?: number;

  /** Elements found so far */
  elementsFound?: number;

  /** States discovered so far */
  statesFound?: number;

  /** Timestamp of this progress update */
  timestamp: string;
}

// ============================================================================
// Unified Request
// ============================================================================

/**
 * Unified extraction request that can specify any extraction method.
 */
export interface UnifiedExtractionRequest {
  /** Extraction method to use */
  method: ExtractionMethod;

  /** Client session ID (for multi-session support) */
  sessionId?: string;

  // --- Source specification ---

  /** Screenshot as base64 or file path */
  screenshot?: string;

  /** URL to extract from */
  url?: string;

  /** Multiple URLs for web extraction */
  urls?: string[];

  /** Template image for pattern matching (base64 or path) */
  template?: string;

  // --- Common options ---

  /** Minimum confidence threshold */
  confidence?: number;

  /** Search region to limit extraction area */
  searchRegion?: UnifiedBoundingBox;

  // --- Vision options ---

  /** Vision techniques to run */
  techniques?: ("edge" | "sam3" | "ocr")[];

  /** Edge detection parameters */
  edgeParams?: {
    cannyLow?: number;
    cannyHigh?: number;
    minContourArea?: number;
  };

  /** SAM3 parameters */
  sam3Params?: {
    pointsPerSide?: number;
    predIouThresh?: number;
    stabilityScoreThresh?: number;
  };

  /** OCR parameters */
  ocrParams?: {
    engine?: "easyocr" | "tesseract";
    languages?: string[];
  };

  // --- Playwright options ---

  /** Max crawl depth */
  maxDepth?: number;

  /** Max elements per page */
  maxElementsPerPage?: number;

  /** Max risk level to interact with */
  maxRiskLevel?: RiskLevel | "dry_run";

  /** Dry run mode (identify without clicking) */
  dryRun?: boolean;

  /** Verify extractions with pattern matching */
  verifyExtractions?: boolean;

  /** Verification threshold */
  verificationThreshold?: number;

  /** Additional blocked keywords */
  blockedKeywords?: string[];

  /** Additional safe keywords */
  safeKeywords?: string[];

  /** Blocked CSS selectors */
  blockedSelectors?: string[];

  // --- Pattern matching options ---

  /** Similarity threshold for pattern matching */
  similarity?: number;

  /** Find all matches vs best match */
  findAll?: boolean;

  /** Maximum matches to return */
  maxMatches?: number;

  // --- Web extraction options ---

  /** Viewports for web extraction */
  viewports?: [number, number][];

  /** Capture hover states */
  captureHoverStates?: boolean;

  /** Capture focus states */
  captureFocusStates?: boolean;

  /** Max pages to crawl */
  maxPages?: number;

  // --- Backend integration ---

  /** Backend session ID for callbacks */
  backendSessionId?: string;

  /** Backend URL for callbacks */
  backendUrl?: string;

  /** Auth token for backend API */
  authToken?: string;
}

// ============================================================================
// Job Management
// ============================================================================

/**
 * Job listing entry for the unified job manager.
 */
export interface UnifiedExtractionJob {
  /** Job ID */
  jobId: string;

  /** Extraction method */
  method: ExtractionMethod;

  /** Current status */
  status: ExtractionStatus;

  /** Progress percentage */
  progress: number;

  /** Progress message */
  progressMessage?: string;

  /** Client session ID */
  sessionId?: string;

  /** Source URL or description */
  source?: string;

  /** Creation timestamp */
  createdAt: string;

  /** Start timestamp */
  startedAt?: string;

  /** Completion timestamp */
  completedAt?: string;

  /** Error message if failed */
  error?: string;

  /** Whether results are available */
  hasResults: boolean;
}

// ============================================================================
// Converters (to be implemented in a separate file)
// ============================================================================

/**
 * Type guard to check if an element has DOM-based properties.
 */
export function isDOMElement(element: UnifiedElement): boolean {
  return !!element.selector || !!element.tagName;
}

/**
 * Type guard to check if an element has vision-based properties.
 */
export function isVisionElement(element: UnifiedElement): boolean {
  return (
    element.detectionMethod === "vision" ||
    !!element.contourArea ||
    !!element.maskArea
  );
}

/**
 * Type guard to check if an element is from pattern matching.
 */
export function isPatternElement(element: UnifiedElement): boolean {
  return element.detectionMethod === "pattern" || element.similarity !== undefined;
}

/**
 * Type guard to check if an element has safety classification.
 */
export function hasRiskLevel(element: UnifiedElement): boolean {
  return !!element.riskLevel;
}
