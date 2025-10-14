/**
 * Qontinui Automation Configuration Schema
 * Version 1.0.0
 *
 * This defines the structure for exported automation configurations
 * that can be consumed by the Qontinui runner.
 */

export interface QontinuiConfig {
  version: string;
  metadata: ConfigMetadata;
  images: ImageAsset[];
  processes: Process[];
  states: State[];
  transitions: Transition[];
  categories: string[]; // List of process categories
  settings?: ConfigSettings;
  schedules?: Schedule[]; // Automated process schedules
  executionRecords?: ExecutionRecord[]; // Schedule execution history
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
}

export interface ImageAsset {
  id: string;
  name: string;
  data: string; // Base64 encoded image
  format: 'png' | 'jpg' | 'jpeg';
  width: number;
  height: number;
  hash?: string; // SHA256 hash for integrity
}

export interface Process {
  id: string;
  name: string;
  description?: string;
  category?: string; // Category for organizing processes
  type: 'sequence' | 'conditional' | 'loop';
  actions: Action[];
  variables?: ProcessVariable[];
  errorHandling?: ErrorHandler;
}

export interface Action {
  id: string;
  type: ActionType;
  name?: string;
  config: ActionConfig;
  timeout?: number;
  retryCount?: number;
  continueOnError?: boolean;
}

export type ActionType =
  // Find actions
  | 'FIND'
  | 'FIND_STATE_IMAGE'
  // Pure mouse actions
  | 'MOUSE_MOVE'
  | 'MOUSE_DOWN'
  | 'MOUSE_UP'
  | 'MOUSE_SCROLL'
  // Combined mouse actions
  | 'CLICK'
  | 'DOUBLE_CLICK'
  | 'RIGHT_CLICK'
  | 'DRAG'
  | 'SCROLL'
  // Pure keyboard actions
  | 'KEY_PRESS'
  | 'KEY_DOWN'
  | 'KEY_UP'
  // Combined keyboard actions
  | 'TYPE'
  // Other actions
  | 'WAIT'
  | 'VANISH'
  | 'GO_TO_STATE'
  | 'RUN_PROCESS'
  | 'EXISTS'
  | 'SCREENSHOT'
  | 'CONDITION'
  | 'LOOP';

export interface ActionConfig {
  // === Base ActionConfig Properties (inherited by all actions) ===
  // Timing control
  pauseBeforeBegin?: number; // Pause before action starts (seconds)
  pauseAfterEnd?: number; // Pause after action completes (seconds)

  // Behavior control
  illustrate?: 'YES' | 'NO' | 'USE_GLOBAL'; // Override global illustration setting
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
    type: 'image' | 'region' | 'text' | 'coordinates';
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
  searchType?: 'FIRST' | 'ALL' | 'BEST' | 'EACH'; // Type of search
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
    ocrEngine?: 'TESSERACT' | 'EASYOCR' | 'PADDLEOCR' | 'NATIVE';
    language?: string;
    whitelistChars?: string;
    blacklistChars?: string;
    matchType?: 'EXACT' | 'CONTAINS' | 'STARTS_WITH' | 'ENDS_WITH' | 'REGEX' | 'FUZZY';
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
  mouseButton?: 'LEFT' | 'RIGHT' | 'MIDDLE'; // Mouse button to use
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
  direction?: 'up' | 'down' | 'left' | 'right'; // Scroll direction
  distance?: number; // Scroll distance (deprecated - use clicks)
  clicks?: number; // Number of scroll clicks
  smooth?: boolean; // Enable smooth scrolling
  delayBetweenScrolls?: number; // Delay between scroll actions

  // === Move Options ===
  moveInstantly?: boolean; // Instant vs animated movement
  moveSpeed?: number; // Speed of animated movement (seconds)

  // === Wait Options ===
  duration?: number; // Wait duration (seconds)
  waitFor?: 'time' | 'image' | 'state' | 'condition'; // What to wait for
  conditionCheckInterval?: number; // Check interval for conditions
  logProgress?: boolean; // Log wait progress

  // === Vanish Options ===
  maxWaitTime?: number; // Maximum time to wait for vanish
  vanishPollInterval?: number; // Poll interval for vanish check

  // === Repetition Options (for individual actions) ===
  repetitionOptions?: {
    timesToRepeat?: number; // Times to repeat individual action
    pauseBetweenActions?: number; // Pause between repetitions
    maxRepetitions?: number; // Maximum allowed repetitions
  };

  // === Process Repetition Options (for RUN_PROCESS action) ===
  processRepetition?: {
    enabled?: boolean; // Whether to repeat the process
    maxRepeats?: number; // Maximum number of repeats (1 = run once more)
    delay?: number; // Delay between repeats in milliseconds
    untilSuccess?: boolean; // If true: stop early on success, otherwise run all maxRepeats
  };

  // === Verification Options ===
  verificationOptions?: {
    event?: 'TEXT_APPEARS' | 'TEXT_DISAPPEARS' | 'IMAGE_APPEARS' | 'IMAGE_DISAPPEARS' | 'STATE_CHANGE' | 'NONE';
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
  type: 'image_exists' | 'image_vanished' | 'text_exists' | 'custom';
  imageId?: string;
  text?: string;
  customScript?: string;
  thenActions?: string[]; // Action IDs
  elseActions?: string[]; // Action IDs
}

export interface LoopConfig {
  type: 'count' | 'while' | 'until';
  count?: number;
  condition?: ConditionConfig;
  actions: string[]; // Action IDs
  maxIterations?: number;
}

export interface ProcessVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'image';
  value?: any;
  scope: 'local' | 'global';
}

export interface ErrorHandler {
  strategy: 'stop' | 'continue' | 'retry' | 'fallback';
  maxRetries?: number;
  retryDelay?: number;
  fallbackProcess?: string; // Process ID
  notifyOnError?: boolean;
}

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
  entryActions?: string[]; // Process IDs to run on entry
  exitActions?: string[]; // Process IDs to run on exit
  timeout?: number;
  isInitial?: boolean;
  isFinal?: boolean;
}

// Pattern represents a single image variation with search configuration
export interface Pattern {
  id: string;
  name?: string;
  image: string; // Base64 PNG with transparency
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
}

export interface StateLocation {
  id: string;
  name: string;
  x: number;
  y: number;
  anchor?: boolean; // If true, used as anchor point
  fixed?: boolean; // If true, location is fixed
}

export interface StateString {
  id: string;
  name: string;
  value: string;
  identifier?: boolean; // If true, used to identify state
  inputText?: boolean; // If true, used as input text
  expectedText?: boolean; // If true, expected to appear in state
  regex?: boolean; // If true, value is a regex pattern
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
  type: 'FromTransition' | 'ToTransition';
  name?: string;
  description?: string;
  processes: string[]; // Process IDs to execute
  timeout: number;
  retryCount: number;
  priority?: number; // For handling multiple valid transitions
}

export interface FromTransition extends Transition {
  type: 'FromTransition';
  fromState: string; // State ID
  toState: string; // State ID
  staysVisible: boolean;
  activateStates: string[]; // State IDs
  deactivateStates: string[]; // State IDs
  condition?: TransitionCondition;
}

export interface ToTransition extends Transition {
  type: 'ToTransition';
  toState: string; // State ID
  executeAfter?: string[]; // FromTransition IDs that trigger this
}

export interface TransitionCondition {
  type: 'always' | 'image' | 'time' | 'custom';
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
  failureStrategy: 'stop' | 'continue' | 'pause';
  headless?: boolean;
  resolution?: {
    width: number;
    height: number;
  };
}

export interface RecognitionSettings {
  defaultThreshold: number;
  searchAlgorithm: 'template_matching' | 'feature_matching' | 'ai';
  multiScaleSearch: boolean;
  colorSpace: 'rgb' | 'grayscale' | 'hsv';
  edgeDetection?: boolean;
  ocrEnabled?: boolean;
  ocrLanguage?: string;
}

export interface LoggingSettings {
  level: 'debug' | 'info' | 'warning' | 'error';
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
export type TriggerType = 'TIME' | 'INTERVAL' | 'STATE' | 'MANUAL';
export type CheckMode = 'CHECK_ALL' | 'CHECK_INACTIVE_ONLY';
export type ScheduleType = 'FIXED_RATE' | 'FIXED_DELAY';

export interface Schedule {
  id: string;
  name: string;
  processId: string;
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
  processId: string;
  startTime: string; // ISO 8601 date string
  endTime?: string; // ISO 8601 date string
  success: boolean;
  iterationCount: number;
  errors: string[];
  metadata: Record<string, any>;
}

// Validation schema using JSON Schema format
export const configJsonSchema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Qontinui Configuration",
  "type": "object",
  "required": ["version", "metadata", "images", "processes", "states", "transitions", "categories"],
  "properties": {
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    },
    "metadata": {
      "type": "object",
      "required": ["name", "created", "modified"],
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "description": { "type": "string" },
        "author": { "type": "string" },
        "created": { "type": "string", "format": "date-time" },
        "modified": { "type": "string", "format": "date-time" },
        "tags": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },
    "images": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "data", "format", "width", "height"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "data": { "type": "string" },
          "format": { "enum": ["png", "jpg", "jpeg"] },
          "width": { "type": "number", "minimum": 1 },
          "height": { "type": "number", "minimum": 1 }
        }
      }
    },
    "processes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "type", "actions"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "category": { "type": "string" },
          "type": { "enum": ["sequence", "conditional", "loop"] },
          "actions": { "type": "array" }
        }
      }
    },
    "states": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "identifyingImages", "position"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "identifyingImages": { "type": "array" },
          "position": {
            "type": "object",
            "required": ["x", "y"],
            "properties": {
              "x": { "type": "number" },
              "y": { "type": "number" }
            }
          }
        }
      }
    },
    "transitions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "type", "processes", "timeout", "retryCount"],
        "properties": {
          "id": { "type": "string" },
          "type": { "enum": ["FromTransition", "ToTransition"] },
          "processes": { "type": "array", "items": { "type": "string" } },
          "timeout": { "type": "number", "minimum": 0 },
          "retryCount": { "type": "number", "minimum": 0 }
        }
      }
    },
    "categories": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
};
