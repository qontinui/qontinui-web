/**
 * Page State Types
 *
 * Type definitions for persisted page state stored in IndexedDB.
 * Each page has its own state interface defining what gets persisted.
 */

import type { Region } from "@/types/pattern-optimization";

// ===== Common Types =====

/** Monitor information for multi-monitor screenshots - matches ScreenshotPicker.MonitorInfo */
export interface MonitorInfo {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  is_primary: boolean;
}

/** Screenshot reference with blob ID for persistence */
export interface PersistedScreenshot {
  id: string;
  name: string;
  /** Blob ID in IndexedDB (not URL) */
  blobId: string;
  /** Runtime URL created from blob - not persisted */
  url?: string;
  region?: Region;
}

/** Composite screenshot with monitor position data */
export interface PersistedCompositeScreenshot {
  id: string;
  name: string;
  blobId: string;
  url?: string;
  monitor: MonitorInfo;
}

// ===== Image Extraction Page State =====

export type ProcessingMode = "none" | "border" | "background";
export type SaveMode = "createStateImage" | "addPattern" | "libraryOnly";

/** Extracted image result with optional mask */
export interface PersistedExtractedResult {
  /** Blob ID for cropped image */
  croppedImageBlobId: string;
  /** Blob ID for mask (optional) */
  maskBlobId: string | null;
  /** Bounds of the extracted region */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Runtime URLs - not persisted */
  croppedImage?: string;
  mask?: string;
}

/** Full state for Image Extraction page */
export interface ImageExtractionPageState {
  // Screenshot state
  currentScreenshot: PersistedScreenshot | null;
  compositeScreenshots: PersistedCompositeScreenshot[];
  isCompositeMode: boolean;
  compositeRegion: Region | null;

  // Processing settings
  processingMode: ProcessingMode;
  tolerance: number;

  // Extracted result
  extractedResult: PersistedExtractedResult | null;

  // Save dialog state
  showSaveDialog: boolean;
  saveMode: SaveMode;
  imageName: string;
  selectedStateId: string;
  newStateName: string;
  selectedStateImageId: string;
  fixedLocation: boolean;

  // Mask editor state
  showMaskEditor: boolean;
  editingMask: {
    imageBlobId: string;
    initialMaskBlobId: string | null;
    imageUrl?: string;
    initialMask?: string;
  } | null;
}

// ===== Pattern Tests Page State =====

export type TemplateSource = "upload" | "state" | "asset";

export interface MatchResult {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  thumbnailBlobId?: string;
  thumbnailUrl?: string;
}

export interface PatternTestsPageState {
  // Screenshot
  selectedScreenshot: PersistedScreenshot | null;
  screenshotDimensions: { width: number; height: number } | null;

  // Template
  templateImage: {
    blobId: string;
    url?: string;
  } | null;
  templateSource: TemplateSource;
  selectedStateImageId: string;
  selectedAssetImageId: string;

  // Matching parameters
  similarity: number;
  findAll: boolean;
  searchRegion: Region | null;

  // Results
  matches: MatchResult[];
  searchTime: number;
  selectedMatchId: string | null;

  // Visualization toggles
  showMatches: boolean;
  showScores: boolean;
  showHeatmap: boolean;
  highlightBest: boolean;

  // Canvas state
  zoom: number;
  panOffset: { x: number; y: number };
}

// ===== Pattern Optimization Page State =====

export interface PatternOptimizationPageState {
  selectedScreenshotId: string | null;
  config: {
    similarityThreshold: number;
    colorAveraging: "mean" | "median" | "weighted";
    morphologicalOps: {
      enabled: boolean;
      erosionSize: number;
      dilationSize: number;
    };
  };
  editMode: "none" | "add" | "remove";
  editedPatternBlobId: string | null;
  editedPatternUrl?: string;
  stepIndex: number;

  // Save dialog
  showStateImageDialog: boolean;
  stateImageName: string;
  selectedStateId: string;
  newStateName: string;
  fixedLocation: boolean;
}

// ===== Semantic Analysis Page State =====

export interface SemanticAnalysisPageState {
  selectedScreenshotId: string | null;
  selectedElementIds: string[];
  analysisResults: Record<string, unknown>;
  showOverlay: boolean;
  highlightMode: "all" | "selected" | "none";
}

// ===== Variables Page State =====

export interface VariablesPageState {
  searchQuery: string;
  selectedVariableIds: string[];
  sortField: "name" | "type" | "value" | "createdAt";
  sortDirection: "asc" | "desc";
  filterType: string | null;
}

// ===== Dependencies Page State =====

export interface DependenciesPageState {
  activeTab: string;
  searchQuery: string;
  filtersOpen: boolean;
  filters: {
    folders: string[];
    tags: string[];
    categories: string[];
    viewMode: "graph" | "list";
  };
  graphViewport: {
    x: number;
    y: number;
    zoom: number;
  };
  selectedWorkflowId: string | null;
}

// ===== States (State Machine) Page State =====

export interface StatesPageState {
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
  selectedStateIds: string[];
  selectedTransitionIds: string[];
  editingStateId: string | null;
  showGrid: boolean;
  snapToGrid: boolean;
}

// ===== Screenshots Page State =====

export interface ScreenshotsPageState {
  uploadedScreenshots: PersistedScreenshot[];
  selectedScreenshotIds: string[];
  viewMode: "grid" | "list";
  sortBy: "name" | "uploadedAt";
  sortDirection: "asc" | "desc";
}

// ===== Page State Union =====

export type PageId =
  | "image-extraction"
  | "pattern-tests"
  | "pattern-optimization"
  | "semantic-analysis"
  | "variables"
  | "dependencies"
  | "states"
  | "screenshots";

export type PageState =
  | ImageExtractionPageState
  | PatternTestsPageState
  | PatternOptimizationPageState
  | SemanticAnalysisPageState
  | VariablesPageState
  | DependenciesPageState
  | StatesPageState
  | ScreenshotsPageState;

// ===== Default States =====

export const DEFAULT_IMAGE_EXTRACTION_STATE: ImageExtractionPageState = {
  currentScreenshot: null,
  compositeScreenshots: [],
  isCompositeMode: false,
  compositeRegion: null,
  processingMode: "none",
  tolerance: 10,
  extractedResult: null,
  showSaveDialog: false,
  saveMode: "createStateImage",
  imageName: "",
  selectedStateId: "",
  newStateName: "",
  selectedStateImageId: "",
  fixedLocation: true,
  showMaskEditor: false,
  editingMask: null,
};

export const DEFAULT_PATTERN_TESTS_STATE: PatternTestsPageState = {
  selectedScreenshot: null,
  screenshotDimensions: null,
  templateImage: null,
  templateSource: "upload",
  selectedStateImageId: "",
  selectedAssetImageId: "",
  similarity: 0.8,
  findAll: true,
  searchRegion: null,
  matches: [],
  searchTime: 0,
  selectedMatchId: null,
  showMatches: true,
  showScores: true,
  showHeatmap: false,
  highlightBest: true,
  zoom: 1,
  panOffset: { x: 0, y: 0 },
};

export const DEFAULT_PATTERN_OPTIMIZATION_STATE: PatternOptimizationPageState = {
  selectedScreenshotId: null,
  config: {
    similarityThreshold: 0.85,
    colorAveraging: "weighted",
    morphologicalOps: {
      enabled: true,
      erosionSize: 1,
      dilationSize: 2,
    },
  },
  editMode: "none",
  editedPatternBlobId: null,
  stepIndex: 0,
  showStateImageDialog: false,
  stateImageName: "",
  selectedStateId: "",
  newStateName: "",
  fixedLocation: true,
};

export const DEFAULT_SEMANTIC_ANALYSIS_STATE: SemanticAnalysisPageState = {
  selectedScreenshotId: null,
  selectedElementIds: [],
  analysisResults: {},
  showOverlay: true,
  highlightMode: "all",
};

export const DEFAULT_VARIABLES_STATE: VariablesPageState = {
  searchQuery: "",
  selectedVariableIds: [],
  sortField: "name",
  sortDirection: "asc",
  filterType: null,
};

export const DEFAULT_DEPENDENCIES_STATE: DependenciesPageState = {
  activeTab: "workflows",
  searchQuery: "",
  filtersOpen: false,
  filters: {
    folders: [],
    tags: [],
    categories: [],
    viewMode: "graph",
  },
  graphViewport: { x: 0, y: 0, zoom: 1 },
  selectedWorkflowId: null,
};

export const DEFAULT_STATES_STATE: StatesPageState = {
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedStateIds: [],
  selectedTransitionIds: [],
  editingStateId: null,
  showGrid: true,
  snapToGrid: true,
};

export const DEFAULT_SCREENSHOTS_STATE: ScreenshotsPageState = {
  uploadedScreenshots: [],
  selectedScreenshotIds: [],
  viewMode: "grid",
  sortBy: "uploadedAt",
  sortDirection: "desc",
};

export function getDefaultState(pageId: PageId): PageState {
  switch (pageId) {
    case "image-extraction":
      return DEFAULT_IMAGE_EXTRACTION_STATE;
    case "pattern-tests":
      return DEFAULT_PATTERN_TESTS_STATE;
    case "pattern-optimization":
      return DEFAULT_PATTERN_OPTIMIZATION_STATE;
    case "semantic-analysis":
      return DEFAULT_SEMANTIC_ANALYSIS_STATE;
    case "variables":
      return DEFAULT_VARIABLES_STATE;
    case "dependencies":
      return DEFAULT_DEPENDENCIES_STATE;
    case "states":
      return DEFAULT_STATES_STATE;
    case "screenshots":
      return DEFAULT_SCREENSHOTS_STATE;
    default:
      throw new Error(`Unknown page ID: ${pageId}`);
  }
}
