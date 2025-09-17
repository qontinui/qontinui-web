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
  settings?: ConfigSettings;
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
  | 'FIND'
  | 'CLICK'
  | 'DOUBLE_CLICK'
  | 'RIGHT_CLICK'
  | 'TYPE'
  | 'KEY_PRESS'
  | 'DRAG'
  | 'SCROLL'
  | 'WAIT'
  | 'VANISH'
  | 'EXISTS'
  | 'MOVE'
  | 'SCREENSHOT'
  | 'CONDITION'
  | 'LOOP';

export interface ActionConfig {
  // Common properties
  target?: {
    type: 'image' | 'region' | 'text' | 'coordinates';
    imageId?: string;
    region?: Region;
    text?: string;
    coordinates?: Coordinates;
    threshold?: number;
  };
  
  // Type-specific properties
  text?: string; // For TYPE action
  keys?: string[]; // For KEY_PRESS action
  direction?: 'up' | 'down' | 'left' | 'right'; // For SCROLL
  distance?: number; // For DRAG, SCROLL
  duration?: number; // For WAIT
  condition?: ConditionConfig; // For CONDITION
  loop?: LoopConfig; // For LOOP
  destination?: Coordinates | Region; // For DRAG, MOVE
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
  identifyingImages: StateImage[];
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

export interface StateImage {
  imageId: string;
  threshold: number;
  required: boolean;
  searchRegion?: Region;
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

export interface ConfigSettings {
  execution: ExecutionSettings;
  recognition: RecognitionSettings;
  logging: LoggingSettings;
  performance: PerformanceSettings;
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

// Validation schema using JSON Schema format
export const configJsonSchema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Qontinui Configuration",
  "type": "object",
  "required": ["version", "metadata", "images", "processes", "states", "transitions"],
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
    }
  }
};