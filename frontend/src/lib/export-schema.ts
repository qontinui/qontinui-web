/**
 * Qontinui Automation Configuration Schema
 * Version 2.12.0
 *
 * This defines the structure for exported automation configurations
 * that can be consumed by the Qontinui runner.
 *
 * CHANGELOG v2.12.0:
 * - Normalized target type from "StateImage" to "stateImage" (lowercase 'i')
 * - Target types now sourced from @qontinui/schemas/targets (single source of truth)
 * - Fixes case sensitivity bug where Python expected lowercase but UI produced uppercase
 *
 * CHANGELOG v2.11.0:
 * - Changed categories from string[] to Category[] with automationEnabled flag
 * - Allows any category to be made available for runner automation (not just "Main")
 * - "Main" category has automationEnabled: true by default
 *
 * CHANGELOG v2.9.0:
 * - Added searchMode to StateImage for controlling how multiple patterns are searched
 * - Options: "separate" (search each pattern individually) or "combined" (use combined vector)
 *
 * CHANGELOG v2.8.0:
 * - Added RAG_FIND action type for semantic/AI-powered element search
 * - Added monitors metadata to StateString elements
 *
 * CHANGELOG v2.7.0:
 * - Added RECURSIVE_VERIFY action for AI-powered recursive state verification
 *
 * CHANGELOG v2.6.0:
 * - Added CAPTURE_CONTEXT action, template variable support, and monitor metadata
 *
 * CHANGELOG v2.10.0:
 * - Replaced TRIGGER_AI_ANALYSIS with AI_PROMPT action type
 *
 * CHANGELOG v2.5.0:
 * - Added AI_PROMPT action type for autonomous debugging (originally named TRIGGER_AI_ANALYSIS)
 * - Invokes AI assistants to analyze automation results and fix issues
 * - Supports provider selection (currently: claude)
 *
 * CHANGELOG v2.4.0:
 * - Added SHELL and SHELL_SCRIPT action types for command execution
 * - Supports multiple shells (bash, sh, powershell, cmd, zsh)
 * - Output can be captured as text, JSON, or lines
 *
 * CHANGELOG v2.3.0:
 * - Added initialStateIds to workflows for model-based GUI automation
 * - Allows specifying which states should be active when a Main workflow starts
 *
 * CHANGELOG v2.2.0:
 * - Normalized state and transition position coordinates to integers
 * - Math.round() applied to all position.x and position.y values
 *
 * CHANGELOG v2.1.0:
 * - Consolidated FIND_STATE_IMAGE into FIND with stateImage target type
 * - "Find State" now uses FIND action with target.type = "stateImage"
 *
 * CHANGELOG v2.0.1:
 * - Removed 'parallel' connection type (GUI automation is sequential)
 *
 * CHANGELOG v2.0.0:
 * - Replaced 'processes' with 'workflows' in graph format
 * - All workflows now in unified graph format with viewMode metadata
 */

import type { WorkflowExpectations, ActionExpectations } from "./expectations";

// Import Category and Context types from qontinui-schemas (single source of truth)
import type {
  Category,
  Context,
  ContextAutoInclude,
} from "@qontinui/shared-types/config";
// Re-export for backward compatibility with existing imports
export type { Category, Context, ContextAutoInclude };

export interface QontinuiConfig {
  version: string;
  metadata: ConfigMetadata;
  images: ImageAsset[];
  workflows: Workflow[]; // Unified graph-format workflows (replaces processes)
  states: State[];
  transitions: Transition[];
  categories: Category[]; // List of workflow categories with automation settings
  contexts?: Context[]; // AI context snippets for runner
  settings?: ConfigSettings;
  schedules?: Schedule[]; // Automated workflow schedules
  executionRecords?: ExecutionRecord[]; // Schedule execution history
}

/**
 * Workflow in graph format - the unified type for all automation
 * Sequential workflows are linear graphs with no branching
 */
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  category?: string;
  format: "graph"; // Always 'graph' in export format
  version: string;
  actions: Action[];
  connections: WorkflowConnections;
  metadata?: WorkflowMetadata;
  expectations?: WorkflowExpectations; // Optional workflow-level expectations
  /**
   * Initial active states when this workflow starts.
   * Required for Main category workflows to enable model-based GUI automation.
   * The qontinui library needs to know which states are active at automation start.
   */
  initialStateIds?: string[];
}

/**
 * Connection from one action to another in graph format.
 * Matches the Pydantic Connection model from qontinui library.
 */
export interface Connection {
  action: string; // Target action ID
  type: string; // Connection type (main, error, success, etc.)
  index: number; // Input index on target action
}

export interface WorkflowConnections {
  [actionId: string]: ActionOutputs;
}

export interface ActionOutputs {
  main?: Connection[][]; // Main output connections
  success?: Connection[][]; // Success path connections
  error?: Connection[][]; // Error path connections
  // Conditional branches for IF actions
  true?: Connection[][];
  false?: Connection[][];
  // Dynamic branches for SWITCH actions (case_0, case_1, etc.)
  [key: string]: Connection[][] | undefined;
}

export interface WorkflowMetadata {
  created?: string;
  updated?: string;
  viewMode?: "sequential" | "graph"; // Preferred visualization mode
  [key: string]: unknown; // Allow additional metadata
}

export interface ConfigMetadata {
  name: string;
  description?: string;
  author?: string;
  created: string;
  modified: string;
  tags?: string[];
  targetApplication?: string;
  compatibleVersions?: {
    runner: string;
    website: string;
  };
  /**
   * Project ID from qontinui-web for test run reporting.
   * When present, the runner uses this instead of localStorage selection.
   */
  projectId?: string;
}

export interface ImageAsset {
  id: string;
  name: string;
  data: string; // Base64 encoded image
  format: "png" | "jpg" | "jpeg";
  width: number;
  height: number;
  hash?: string; // SHA256 hash for integrity
}

export interface Action {
  id: string;
  type: ActionType;
  name?: string;
  config: ActionConfig;
  position?: [number, number]; // [x, y] coordinates for graph visualization
  timeout?: number;
  retryCount?: number;
  continueOnError?: boolean;
  // Checkpoint and expectations fields
  capture_checkpoint_after?: boolean; // Capture checkpoint after action succeeds
  checkpoint_name?: string; // Name of checkpoint to create
  is_terminal_on_failure?: boolean; // If true, workflow stops on action failure
  expectations?: ActionExpectations; // Action-level expectation overrides
}

export type ActionType =
  // Find actions
  | "FIND"
  | "RAG_FIND"
  | "VANISH"
  // Pure mouse actions
  | "MOUSE_MOVE"
  | "MOUSE_DOWN"
  | "MOUSE_UP"
  | "MOUSE_SCROLL"
  // Combined mouse actions (use CLICK with config for double/right click)
  | "CLICK"
  | "DRAG"
  | "SCROLL"
  // Pure keyboard actions
  | "KEY_PRESS"
  | "KEY_DOWN"
  | "KEY_UP"
  // Combined keyboard actions
  | "TYPE"
  | "HOTKEY"
  // Shell actions
  | "SHELL"
  | "SHELL_SCRIPT"
  // AI actions
  | "AI_PROMPT"
  // State/navigation actions
  | "GO_TO_STATE"
  | "RUN_WORKFLOW"
  | "SCREENSHOT"
  // Control flow actions
  | "IF"
  | "LOOP"
  | "BREAK"
  | "CONTINUE"
  | "SWITCH"
  | "TRY_CATCH"
  // Data actions
  | "SET_VARIABLE"
  | "GET_VARIABLE"
  | "SORT"
  | "FILTER"
  | "MAP"
  | "REDUCE"
  | "STRING_OPERATION"
  | "MATH_OPERATION"
  // Code actions
  | "CODE_BLOCK"
  | "CUSTOM_FUNCTION";

export interface ActionConfig {
  // === Base ActionConfig Properties (inherited by all actions) ===
  // Timing control
  pauseBeforeBegin?: number; // Pause before action starts (seconds)
  pauseAfterEnd?: number; // Pause after action completes (seconds)

  // Behavior control
  illustrate?: "YES" | "NO" | "USE_GLOBAL"; // Override global illustration setting
  subsequentActions?: ActionConfig[]; // Chain actions to execute after
  logType?: string; // Log event type for categorization

  // Logging options
  loggingOptions?: {
    beforeActionMessage?: string;
    afterActionMessage?: string;
    successMessage?: string;
    failureMessage?: string;
    logBeforeAction?: boolean;
    logAfterAction?: boolean;
    logOnSuccess?: boolean;
    logOnFailure?: boolean;
    beforeActionLevel?: string;
    afterActionLevel?: string;
    successLevel?: string;
    failureLevel?: string;
  };

  // === Target Configuration ===
  target?: {
    type: "image" | "region" | "text" | "coordinates";
    imageId?: string;
    region?: Region;
    text?: string;
    coordinates?: Coordinates;
    threshold?: number; // Similarity threshold (deprecated - use similarity)
  };

  // === Find/Search Options (BaseFindOptions) ===
  similarity?: number; // Minimum similarity threshold (0.0-1.0)
  searchRegions?: Region[]; // Regions to search within
  captureImage?: boolean; // Capture image of match for logging
  useDefinedRegion?: boolean; // Use defined regions instead of searching
  maxMatchesToActOn?: number; // Maximum matches to act on
  searchDuration?: number; // Search duration in seconds
  searchType?: "FIRST" | "ALL" | "BEST" | "EACH"; // Type of search
  maxMatches?: number; // Maximum matches to return
  minMatches?: number; // Minimum matches required for success
  timeout?: number; // Maximum search time in seconds
  pollInterval?: number; // Time between search attempts

  // === Match Adjustment Options ===
  matchAdjustment?: {
    targetPosition?: string; // Override default position in match
    targetOffset?: Coordinates; // Pixel offset from target position
    addW?: number; // Pixels to add to width
    addH?: number; // Pixels to add to height
    absoluteW?: number; // Absolute width override
    absoluteH?: number; // Absolute height override
    addX?: number; // Pixels to add to X coordinate
    addY?: number; // Pixels to add to Y coordinate
  };

  // === Pattern Find Options (template matching) ===
  patternOptions?: {
    matchMethod?: string; // CORRELATION, CORRELATION_NORMED, etc.
    scaleInvariant?: boolean; // Search at multiple scales
    rotationInvariant?: boolean; // Search at multiple rotations
    minScale?: number;
    maxScale?: number;
    scaleStep?: number;
    minRotation?: number;
    maxRotation?: number;
    rotationStep?: number;
    useGrayscale?: boolean;
    useColorReduction?: boolean;
    colorTolerance?: number;
    useEdges?: boolean;
    edgeThreshold1?: number;
    edgeThreshold2?: number;
    nonMaxSuppression?: boolean;
    nmsThreshold?: number;
    minDistanceBetweenMatches?: number;
  };

  // === Text Find Options (OCR-based) ===
  textOptions?: {
    ocrEngine?: "TESSERACT" | "EASYOCR" | "PADDLEOCR" | "NATIVE";
    language?: string;
    whitelistChars?: string;
    blacklistChars?: string;
    matchType?:
      | "EXACT"
      | "CONTAINS"
      | "STARTS_WITH"
      | "ENDS_WITH"
      | "REGEX"
      | "FUZZY";
    caseSensitive?: boolean;
    ignoreWhitespace?: boolean;
    normalizeUnicode?: boolean;
    fuzzyThreshold?: number;
    editDistance?: number;
    preprocessing?: string[];
    scaleFactor?: number;
    psmMode?: number;
    oemMode?: number;
    confidenceThreshold?: number;
  };

  // === Click Options ===
  numberOfClicks?: number; // Number of clicks (1 = single, 2 = double, etc.)
  mouseButton?: "LEFT" | "RIGHT" | "MIDDLE"; // Mouse button to use
  pressDuration?: number; // How long to hold button (seconds)
  pauseAfterPress?: number; // Pause after pressing
  pauseAfterRelease?: number; // Pause after releasing

  // === Type Options ===
  text?: string; // Text to type
  typeDelay?: number; // Delay between keystrokes (seconds)
  modifiers?: string; // Modifier keys (e.g., "SHIFT", "CTRL+ALT")

  // === Key Press Options ===
  keys?: string[]; // Keys to press
  pauseBetweenKeys?: number; // Pause between key presses
  releaseModifiersFirst?: boolean; // For KEY_UP actions

  // === Drag Options ===
  destination?: Coordinates | Region; // Drag destination
  dragDuration?: number; // Duration of drag movement
  delayBetweenMouseDownAndMove?: number; // Delay before dragging
  delayAfterDrag?: number; // Delay after drag completes

  // === Scroll Options ===
  direction?: "up" | "down" | "left" | "right"; // Scroll direction
  distance?: number; // Scroll distance (deprecated - use clicks)
  clicks?: number; // Number of scroll clicks
  smooth?: boolean; // Enable smooth scrolling
  delayBetweenScrolls?: number; // Delay between scroll actions

  // === Move Options ===
  moveInstantly?: boolean; // Instant vs animated movement
  moveSpeed?: number; // Speed of animated movement (seconds)

  // === Wait Options ===
  duration?: number; // Wait duration (seconds)
  waitFor?: "time" | "image" | "state" | "condition"; // What to wait for
  conditionCheckInterval?: number; // Check interval for conditions
  logProgress?: boolean; // Log wait progress

  // === Vanish Options ===
  maxWaitTime?: number; // Maximum time to wait for vanish
  vanishPollInterval?: number; // Poll interval for vanish check

  // === GO_TO_STATE Options ===
  stateIds?: string[]; // Target state IDs for GO_TO_STATE action
  stateNames?: string[]; // Target state names (for readability in export)
  strategy?: "all" | "any" | "optimal"; // Pathfinding strategy for multiple states
  verify?: boolean; // Verify state(s) were reached

  // === Repetition Options (for individual actions) ===
  repetitionOptions?: {
    timesToRepeat?: number; // Times to repeat individual action
    pauseBetweenActions?: number; // Pause between repetitions
    maxRepetitions?: number; // Maximum allowed repetitions
  };

  // === Workflow Repetition Options (for RUN_WORKFLOW action) ===
  workflowRepetition?: {
    enabled?: boolean; // Whether to repeat the workflow
    maxRepeats?: number; // Maximum number of repeats (1 = run once more)
    delay?: number; // Delay between repeats in milliseconds
    untilSuccess?: boolean; // If true: stop early on success, otherwise run all maxRepeats
  };

  // === Verification Options ===
  verificationOptions?: {
    event?:
      | "TEXT_APPEARS"
      | "TEXT_DISAPPEARS"
      | "IMAGE_APPEARS"
      | "IMAGE_DISAPPEARS"
      | "STATE_CHANGE"
      | "NONE";
    text?: string; // Text to verify
    images?: string[]; // Image IDs to verify
    timeout?: number; // Verification timeout
  };

  // === Highlight Options (debugging) ===
  highlightOptions?: {
    duration?: number; // Highlight duration
    color?: [number, number, number]; // RGB color
    thickness?: number; // Border thickness
    flash?: boolean; // Flash effect
    flashTimes?: number; // Number of flashes
  };

  // === Condition/Loop (legacy - kept for compatibility) ===
  condition?: ConditionConfig;
  loop?: LoopConfig;

  // === AI_PROMPT Options ===
  aiProvider?: "claude"; // AI provider to use (currently: claude)
  prompt?: string; // AI prompt text
  freshContext?: boolean; // Start fresh AI session
  aiTimeout?: number; // AI execution timeout
  outputVariable?: string; // Variable to store output
  resultsDirectory?: string; // Path to automation results directory
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Coordinates {
  x: number;
  y: number;
}

export interface ConditionConfig {
  type: "image_exists" | "image_vanished" | "text_exists" | "custom";
  imageId?: string;
  text?: string;
  customScript?: string;
  thenActions?: string[]; // Action IDs
  elseActions?: string[]; // Action IDs
}

export interface LoopConfig {
  type: "count" | "while" | "until";
  count?: number;
  condition?: ConditionConfig;
  actions: string[]; // Action IDs
  maxIterations?: number;
}

// Legacy types removed - workflows use built-in error handling via action config

export interface State {
  id: string;
  name: string;
  description?: string;
  stateImages: StateImage[];
  regions?: StateRegion[]; // Regions associated with this state
  locations?: StateLocation[]; // Locations associated with this state
  strings?: StateString[]; // Strings associated with this state
  position: {
    x: number;
    y: number;
  };
  entryActions?: string[]; // Workflow IDs to run on entry
  exitActions?: string[]; // Workflow IDs to run on exit
  timeout?: number;
  isInitial?: boolean;
  isFinal?: boolean;
}

// Pattern represents a single image variation with search configuration
export interface Pattern {
  id: string;
  name?: string;
  imageId: string; // Reference to image ID in images array
  mask?: string; // Optional mask
  searchRegions?: SearchRegion[]; // Pattern-level search regions (precedence level 2)
  fixed: boolean; // If true, pattern position is fixed on screen
  similarity?: number; // Similarity threshold (0.0-1.0)
  targetPosition?: {
    percentW: number;
    percentH: number;
  }; // Click position within pattern
  offsetX?: number; // Pixel offset for click position
  offsetY?: number; // Pixel offset for click position
}

export interface StateImage {
  id: string;
  name: string;
  patterns: Pattern[]; // Multiple patterns for visual variations (e.g., normal, hover, clicked)
  shared: boolean; // If true, found in other states too
  probability?: number; // Mock testing: probability image appears (0.0-1.0)
  source?: string; // Track how the image was created
  searchRegions?: SearchRegion[]; // StateImage-level search regions (precedence level 3)
  monitors?: number[]; // Monitor IDs where this image should be found
  searchMode?: "separate" | "combined"; // How to search multiple patterns (default: "separate")
}

export interface StateRegion {
  id: string;
  name: string;
  bounds: Region;
  fixed?: boolean; // If true, region is fixed in position
  isSearchRegion?: boolean; // If true, used as search region for state
  isInteractionRegion?: boolean; // If true, used for interactions
  // Relative positioning
  referenceImageId?: string; // ID of StateImage for relative positioning
  position?: {
    percentW: number;
    percentH: number;
    positionName?: string;
  };
  offsetX?: number; // X offset in pixels
  offsetY?: number; // Y offset in pixels
  monitors?: number[]; // Monitor IDs where this region should be found
}

export interface StateLocation {
  id: string;
  name: string;
  x: number;
  y: number;
  anchor?: boolean; // If true, used as anchor point
  fixed?: boolean; // If true, location is fixed
  monitors?: number[]; // Monitor IDs where this location should be found
}

export interface StateString {
  id: string;
  name: string;
  value: string;
  identifier?: boolean; // If true, used to identify state
  inputText?: boolean; // If true, used as input text
  expectedText?: boolean; // If true, expected to appear in state
  regex?: boolean; // If true, value is a regex pattern
  monitors?: number[]; // Monitor IDs where this string should be found
}

export interface SearchRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  referenceImageId?: string; // Link to StateImage for relative positioning
}

export interface SearchRegions {
  regions: Region[]; // List of regions to search within
}

export interface Transition {
  id: string;
  type: "OutgoingTransition" | "IncomingTransition";
  name?: string;
  description?: string;
  workflows: string[]; // Workflow IDs to execute in order (all workflows are in global database)
  timeout: number;
  retryCount: number;
  priority?: number; // For handling multiple valid transitions
}

export interface OutgoingTransition extends Transition {
  type: "OutgoingTransition";
  fromState: string; // State ID
  toState: string; // State ID
  staysVisible: boolean;
  activateStates: string[]; // State IDs
  deactivateStates: string[]; // State IDs
  condition?: TransitionCondition;
}

export interface IncomingTransition extends Transition {
  type: "IncomingTransition";
  toState: string; // State ID
  executeAfter?: string[]; // OutgoingTransition IDs that trigger this
}

export interface TransitionCondition {
  type: "always" | "image" | "time" | "custom";
  imageId?: string;
  threshold?: number;
  timeDelay?: number;
  customScript?: string;
}

export interface MouseActionSettings {
  click_hold_duration: number;
  click_release_delay: number;
  click_safety_release: boolean;
  double_click_interval: number;
  drag_start_delay: number;
  drag_end_delay: number;
  drag_default_duration: number;
  move_default_duration: number;
  safety_release_delay: number;
}

export interface KeyboardActionSettings {
  key_hold_duration: number;
  key_release_delay: number;
  typing_interval: number;
  hotkey_hold_duration: number;
  hotkey_press_interval: number;
}

export interface FindActionSettings {
  default_timeout: number;
  default_retry_count: number;
  search_interval: number;
}

export interface WaitActionSettings {
  pause_before_action: number;
  pause_after_action: number;
}

export interface ConfigSettings {
  execution: ExecutionSettings;
  recognition: RecognitionSettings;
  logging?: LoggingSettings;
  performance?: PerformanceSettings;
  mouse?: MouseActionSettings;
  keyboard?: KeyboardActionSettings;
  find?: FindActionSettings;
  wait?: WaitActionSettings;
}

export interface ExecutionSettings {
  defaultTimeout: number;
  defaultRetryCount: number;
  actionDelay: number; // Delay between actions
  failureStrategy: "stop" | "continue" | "pause";
  headless?: boolean;
  resolution?: {
    width: number;
    height: number;
  };
}

export interface RecognitionSettings {
  defaultThreshold: number;
  searchAlgorithm: "template_matching" | "feature_matching" | "ai";
  multiScaleSearch: boolean;
  colorSpace: "rgb" | "grayscale" | "hsv";
  edgeDetection?: boolean;
  ocrEnabled?: boolean;
  ocrLanguage?: string;
}

export interface LoggingSettings {
  level: "debug" | "info" | "warning" | "error";
  screenshotOnError: boolean;
  logFile?: string;
  consoleOutput: boolean;
  detailedMatching: boolean;
}

export interface PerformanceSettings {
  maxParallelActions: number;
  cpuLimit?: number; // Percentage
  memoryLimit?: number; // MB
  cacheImages: boolean;
  optimizeSearch: boolean;
}

// Scheduler interfaces
export type TriggerType = "TIME" | "INTERVAL" | "STATE" | "MANUAL";
export type CheckMode = "CHECK_ALL" | "CHECK_INACTIVE_ONLY";
export type ScheduleType = "FIXED_RATE" | "FIXED_DELAY";

export interface Schedule {
  id: string;
  name: string;
  workflowId: string; // Workflow ID
  description?: string;
  triggerType: TriggerType;
  checkMode: CheckMode;
  scheduleType: ScheduleType;
  cronExpression?: string;
  intervalSeconds?: number;
  triggerState?: string;
  maxIterations?: number;
  stateCheckDelaySeconds: number;
  stateRebuildDelaySeconds: number;
  failureThreshold: number;
  enabled: boolean;
  createdAt?: string; // ISO 8601 date string
  lastExecutedAt?: string; // ISO 8601 date string
  projectName?: string;
}

export interface ExecutionRecord {
  id: string;
  scheduleId: string;
  workflowId: string; // Workflow ID
  startTime: string; // ISO 8601 date string
  endTime?: string; // ISO 8601 date string
  success: boolean;
  iterationCount: number;
  errors: string[];
  metadata: Record<string, unknown>;
}

// Validation schema using JSON Schema format
export const configJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Qontinui Configuration",
  type: "object",
  required: [
    "version",
    "metadata",
    "images",
    "workflows",
    "states",
    "transitions",
    "categories",
  ],
  properties: {
    version: {
      type: "string",
      pattern: "^\\d+\\.\\d+\\.\\d+$",
    },
    metadata: {
      type: "object",
      required: ["name", "created", "modified"],
      properties: {
        name: { type: "string", minLength: 1 },
        description: { type: "string" },
        author: { type: "string" },
        created: { type: "string", format: "date-time" },
        modified: { type: "string", format: "date-time" },
        tags: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    images: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "data", "format", "width", "height"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          data: { type: "string" },
          format: { enum: ["png", "jpg", "jpeg"] },
          width: { type: "number", minimum: 1 },
          height: { type: "number", minimum: 1 },
        },
      },
    },
    workflows: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "format", "version", "actions", "connections"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          category: { type: "string" },
          format: { const: "graph" },
          version: { type: "string" },
          actions: { type: "array" },
          connections: {
            type: "object",
            description: "Graph connections defining workflow execution flow",
            patternProperties: {
              "^[a-zA-Z0-9_-]+$": {
                type: "object",
                properties: {
                  main: {
                    type: "array",
                    description: "Main execution path (default)",
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["action", "type", "index"],
                        properties: {
                          action: {
                            type: "string",
                            description: "Target action ID",
                          },
                          type: {
                            type: "string",
                            description: "Connection type",
                          },
                          index: {
                            type: "number",
                            minimum: 0,
                            description: "Input index on target",
                          },
                        },
                      },
                    },
                  },
                  success: {
                    type: "array",
                    description: "Path taken when action succeeds",
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["action", "type", "index"],
                        properties: {
                          action: { type: "string" },
                          type: { type: "string" },
                          index: { type: "number", minimum: 0 },
                        },
                      },
                    },
                  },
                  error: {
                    type: "array",
                    description: "Path taken when action fails",
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["action", "type", "index"],
                        properties: {
                          action: { type: "string" },
                          type: { type: "string" },
                          index: { type: "number", minimum: 0 },
                        },
                      },
                    },
                  },
                  parallel: {
                    type: "array",
                    description:
                      "Parallel execution paths (read-only actions only)",
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["action", "type", "index"],
                        properties: {
                          action: { type: "string" },
                          type: { type: "string" },
                          index: { type: "number", minimum: 0 },
                        },
                      },
                    },
                  },
                },
                additionalProperties: true,
              },
            },
          },
          metadata: { type: "object" },
        },
      },
    },
    states: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "identifyingImages", "position"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          identifyingImages: { type: "array" },
          position: {
            type: "object",
            required: ["x", "y"],
            properties: {
              x: { type: "number" },
              y: { type: "number" },
            },
          },
        },
      },
    },
    transitions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "type", "workflows", "timeout", "retryCount"],
        properties: {
          id: { type: "string" },
          type: { enum: ["OutgoingTransition", "IncomingTransition"] },
          workflows: { type: "array", items: { type: "string" } },
          timeout: { type: "number", minimum: 0 },
          retryCount: { type: "number", minimum: 0 },
        },
      },
    },
    categories: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "automationEnabled"],
        properties: {
          name: { type: "string", minLength: 1 },
          automationEnabled: { type: "boolean" },
        },
      },
    },
    contexts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "content", "createdAt", "modifiedAt"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          content: { type: "string" },
          category: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          autoInclude: {
            type: "object",
            properties: {
              taskMentions: { type: "array", items: { type: "string" } },
              actionTypes: { type: "array", items: { type: "string" } },
              errorPatterns: { type: "array", items: { type: "string" } },
              filePatterns: { type: "array", items: { type: "string" } },
            },
          },
          createdAt: { type: "string" },
          modifiedAt: { type: "string" },
        },
      },
    },
  },
};
