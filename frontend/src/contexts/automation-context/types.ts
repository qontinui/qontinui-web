// Import ActionSnapshot type
import { ActionSnapshot } from "../../lib/integration-testing-framework";
import type { ProjectSettings } from "@/types/project-settings";
import type { Workflow } from "@/lib/action-schema/action-types";

// ActionHistory type for state objects
export interface ActionHistory {
  snapshots: ActionSnapshot[];
  lastUpdated?: Date;
}

// ============================================================================
// NOTE: Process type has been removed - use Workflow from action-schema instead
// All processes are now Workflows (graph format with linear connections)
// ============================================================================

export interface StateRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;

  // Relative positioning (similar to StateLocation)
  referenceImageId?: string; // ID of StateImage for relative positioning
  position?: Position; // Position within referenced image region
  offsetX?: number; // X offset in pixels (default 0)
  offsetY?: number; // Y offset in pixels (default 0)

  // Bounding box (alternative to x, y, width, height)
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  // SearchRegion flag
  isSearchRegion?: boolean; // If true, this region can be used as a search region for StateImages

  actionHistory?: ActionHistory;
}

// Position names for relative positioning (matches qontinui PositionName enum)
export type PositionName =
  | "TOPLEFT"
  | "TOPMIDDLE"
  | "TOPRIGHT"
  | "MIDDLELEFT"
  | "MIDDLEMIDDLE"
  | "MIDDLERIGHT"
  | "BOTTOMLEFT"
  | "BOTTOMMIDDLE"
  | "BOTTOMRIGHT";

// Position within a region using percentages (0.0-1.0)
export interface Position {
  percentW: number; // 0.0 = left, 1.0 = right, 0.5 = center
  percentH: number; // 0.0 = top, 1.0 = bottom, 0.5 = center
  positionName?: PositionName; // Optional named position
}

export interface StateLocation {
  id: string;
  name: string;
  x: number;
  y: number;

  // StateLocation specific properties (from qontinui)
  fixed: boolean; // If true, location uses absolute coordinates
  anchor: boolean; // If true, used as anchor point

  // Optional offset values
  offsetX?: number; // X offset in pixels (default 0)
  offsetY?: number; // Y offset in pixels (default 0)

  // For relative positioning
  referenceImageId?: string; // ID of StateImage for relative positioning
  position?: Position; // Position within referenced image region
  anchorType?: string; // Position anchor type
  percentW?: number; // Width percentage (0.0-1.0)
  percentH?: number; // Height percentage (0.0-1.0)

  // Metadata and history
  metadata?: Record<string, any>;
  actionHistory?: ActionHistory;
}

export interface StateString {
  id: string;
  name: string;
  value: string;
  // Type flags - define how the string is used
  identifier?: boolean; // OCR verification flag
  inputText?: boolean; // To be typed (DEFAULT: true)
  expectedText?: boolean; // Validation/expected text flag
  regexPattern?: boolean; // Regex pattern flag
}

export interface SearchRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  referenceImageId?: string; // ID of StateImage for relative positioning
  position?: Position; // Position within referenced image region
  offsetX?: number; // X offset in pixels (default 0)
  offsetY?: number; // Y offset in pixels (default 0)
}

// Pattern represents a single image variation with its search configuration
// Images are referenced by ID from the Library - Library is the source of truth
export interface Pattern {
  id: string;
  name?: string;
  imageId?: string; // ID of ImageAsset in library (library is source of truth)
  searchRegions: SearchRegion[]; // Where to search for this pattern
  fixed: boolean; // If true, pattern position is fixed on screen
  similarity?: number; // Similarity threshold (0.0-1.0)
  targetPosition?: Position; // Click position within pattern (default: center 0.5, 0.5)
  offsetX?: number; // Pixel offset for click position
  offsetY?: number; // Pixel offset for click position
}

export interface StateImage {
  id: string;
  name: string;
  patterns: Pattern[]; // Multiple patterns for visual variations (e.g., normal, hover, clicked)
  shared: boolean; // If true, found in other states too
  actionHistory?: ActionHistory;
  source?: "upload" | "pattern-optimization"; // Track how the image was created
  probability?: number; // Mock testing: probability image appears (0.0-1.0)
  searchRegions?: SearchRegion[]; // StateImage-level search regions (precedence level 3)
}

export interface State {
  id: string;
  name: string;
  description: string;
  initial?: boolean;
  isFinal?: boolean;
  stateImages: StateImage[];
  regions: StateRegion[];
  locations: StateLocation[];
  strings: StateString[];
  position: { x: number; y: number };
  projectName?: string;
}

export type TransitionType = "OutgoingTransition" | "IncomingTransition";

export interface BaseTransition {
  id: string;
  type: TransitionType;
  workflows: string[]; // Workflow IDs to execute in order (v2.0.0 format)
  timeout: number;
  retryCount: number;
  position?: { x: number; y: number }; // For transition node positioning
  projectName?: string;
}

export interface OutgoingTransition extends BaseTransition {
  type: "OutgoingTransition";
  fromState: string;
  toState?: string;
  activateStates: string[];
  staysVisible: boolean;
  deactivateStates: string[];
}

export interface IncomingTransition extends BaseTransition {
  type: "IncomingTransition";
  toState: string;
}

export type Transition = OutgoingTransition | IncomingTransition;

export interface ImageUsage {
  type: "state" | "process";
  id: string;
  name: string;
}

export interface ImageAsset {
  id: string;
  name: string;
  url: string;
  mask?: string; // Optional separate mask image (base64)
  size: number;
  createdAt: Date;
  usageCount: number;
  usage?: ImageUsage[];
  projectName?: string;
  source:
    | "uploaded"
    | "pattern_optimization"
    | "image_extraction"
    | "state_discovery";

  // S3 storage fields
  s3_key: string; // S3 object key
  url_expires_at: Date; // When presigned URL expires

  // Versioning support (not yet implemented, but architecture ready)
  version?: number; // Version number (default: 1)
  parentImageId?: string; // ID of the original image if this is a version
  versions?: string[]; // Array of version IDs (only on parent images)
}

// Screenshot annotation types (simplified from full Screenshot types)
export interface ScreenshotRegionAnnotation {
  id: string;
  screenshotId: string;
  stateId: string;
  name: string;
  type: "StateRegion" | "SearchRegion";
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  linkedStateObjectId?: string;
  linkedStateObjectType?: "StateImage";
  referenceStateId?: string;
  saveToStateImageId?: string;
  saveToStateImageStateId?: string;
}

export interface ScreenshotLocationAnnotation {
  id: string;
  screenshotId: string;
  stateId: string;
  name: string;
  x: number;
  y: number;
  anchor?: boolean;
  anchorType?: string;
  fixed?: boolean;
  referenceImageId?: string;
  referenceStateId?: string;
  offsetX?: number;
  offsetY?: number;
  percentW?: number;
  percentH?: number;
}

export interface Screenshot {
  id: string;
  name: string;
  url: string;
  size: number;
  uploadedAt: Date;
  description?: string;
  tags?: string[];
  projectName?: string;
  // Annotations created in Create Regions & Locations tab
  regions?: ScreenshotRegionAnnotation[];
  locations?: ScreenshotLocationAnnotation[];
  associatedStates?: string[];
}

// Scheduler types
export type TriggerType = "TIME" | "INTERVAL" | "STATE" | "MANUAL";
export type CheckMode = "CHECK_ALL" | "CHECK_INACTIVE_ONLY";
export type ScheduleType = "FIXED_RATE" | "FIXED_DELAY";

export interface Schedule {
  id: string;
  name: string;
  processId: string;
  description?: string;
  triggerType: TriggerType;
  checkMode: CheckMode;
  scheduleType: ScheduleType;

  // Time-based triggers
  cronExpression?: string;

  // Interval-based triggers
  intervalSeconds?: number;

  // State-based triggers
  triggerState?: string;

  // Execution limits
  maxIterations?: number;

  // State checking configuration
  stateCheckDelaySeconds: number;
  stateRebuildDelaySeconds: number;
  failureThreshold: number;

  // Execution control
  enabled: boolean;

  // Metadata
  createdAt?: Date;
  lastExecutedAt?: Date;
  projectName?: string;
}

export interface ExecutionRecord {
  id: string;
  scheduleId: string;
  processId: string;
  startTime: Date;
  endTime?: Date;
  success: boolean;
  iterationCount: number;
  errors: string[];
  metadata: Record<string, any>;
}

export interface StateCheckResult {
  scheduleId: string;
  scheduleName: string;
  checkTime: Date;
  allStatesPresent: boolean;
  missingStates: string[];
  failureStreak: number;
  exceededThreshold: boolean;
  action: "NONE" | "WAIT" | "REBUILD";
}

export interface SchedulerStatistics {
  totalSchedules: number;
  activeSchedules: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageIterationCount: number;
}

// Import Workflow type for context
import type { Workflow } from "@/lib/action-schema/action-types";

// Context type
export interface AutomationContextType {
  // Project
  projectName: string;
  setProjectName: (name: string) => void;
  renameProject: (newName: string) => Promise<void>;
  projectId: string | null;
  setProjectId: (id: string | null) => void;

  // Workflow management (unified - replaces both processes and workflows)
  workflows: Workflow[];
  addWorkflow: (workflow: Workflow) => void;
  updateWorkflow: (workflow: Workflow) => void;
  deleteWorkflow: (workflowId: string) => void;

  // State management
  states: State[];
  addState: (state: State) => void;
  updateState: (state: State) => void;
  updateStateWithIdChange: (oldId: string, newState: State) => void;
  deleteState: (stateId: string) => void;

  // Transition management
  transitions: Transition[];
  addTransition: (transition: Transition) => void;
  updateTransition: (transition: Transition) => void;
  deleteTransition: (transitionId: string) => void;

  // Image management
  images: ImageAsset[];
  addImage: (image: ImageAsset) => void;
  deleteImage: (imageId: string) => void;
  updateImage: (image: ImageAsset) => void;
  updateImageUsage: (imageId: string, usage: ImageUsage) => void;
  removeImageUsage: (imageId: string, usageId: string) => void;
  getImageUsage: (imageId: string) => {
    states: Array<{ id: string; name: string }>;
    processes: Array<{ id: string; name: string; actionCount: number }>;
  };
  removeImageFromStates: (imageUrl: string) => Promise<number>;
  markImageAsRemovedInProcesses: (
    imageId: string,
    imageName: string
  ) => Promise<number>;

  // Image resolution helpers (library is source of truth)
  getImageById: (imageId: string | undefined) => ImageAsset | null;
  resolvePatternImage: (
    pattern: Pattern
  ) => { url: string; mask?: string } | null;

  // Screenshot management
  screenshots: Screenshot[];
  addScreenshot: (screenshot: Screenshot) => void;
  updateScreenshot: (screenshot: Screenshot) => void;
  deleteScreenshot: (screenshotId: string) => void;

  // ActionHistory management
  updateStateImageActionHistory: (
    stateId: string,
    imageId: string,
    actionHistory: ActionHistory
  ) => void;
  updateStateLocationActionHistory: (
    stateId: string,
    locationId: string,
    actionHistory: ActionHistory
  ) => void;
  updateStateRegionActionHistory: (
    stateId: string,
    regionId: string,
    actionHistory: ActionHistory
  ) => void;

  // Auto-save
  lastSaved: string | null;
  triggerSave: () => void;

  // Category management
  categories: string[];
  addCategory: (category: string) => void;
  deleteCategory: (category: string) => void;

  // Settings management
  settings: ProjectSettings;
  updateSettings: (settings: ProjectSettings) => void;

  // Scheduler management
  schedules: Schedule[];
  addSchedule: (schedule: Schedule) => void;
  updateSchedule: (schedule: Schedule) => void;
  deleteSchedule: (scheduleId: string) => void;
  getSchedulerStatistics: () => SchedulerStatistics;

  // Execution history
  executionRecords: ExecutionRecord[];
  getScheduleExecutions: (scheduleId: string) => ExecutionRecord[];

  // Configuration
  getConfiguration: () => any;
  loadConfiguration: (config: any) => Promise<void>;
  clearAllData: () => void;

  // Backend loading control - prevents race conditions
  isLoadingFromBackend: boolean;
  setIsLoadingFromBackend: (loading: boolean) => void;
}
