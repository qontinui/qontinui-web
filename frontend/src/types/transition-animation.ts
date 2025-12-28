/**
 * Transition Animation Types
 *
 * Type definitions for the transition visualization and animation system.
 * Used by TransitionAnimationCanvas and TransitionAnimationController.
 */

import type { Transition, State } from "@/contexts/automation-context/types";
import type { Workflow, ActionType } from "@/lib/action-schema/action-types";

// ============================================================================
// Animation Phases
// ============================================================================

/**
 * Animation phases for transition visualization
 */
export type AnimationPhase =
  | "idle" // No transition selected
  | "showing-initial" // Displaying origin states
  | "executing-action" // Animating current action
  | "transitioning-states" // Fading between states
  | "showing-final" // Displaying final states
  | "completed"; // Animation finished

// ============================================================================
// Animation State
// ============================================================================

/**
 * Current state of the transition animation
 */
export interface TransitionAnimationState {
  /** Current animation phase */
  phase: AnimationPhase;

  /** Index of current workflow being animated */
  currentWorkflowIndex: number;

  /** Index of current action within the workflow */
  currentActionIndex: number;

  /** Animation progress for current phase (0-1) */
  progress: number;

  /** Whether animation is currently playing */
  isPlaying: boolean;

  /** Playback speed multiplier */
  playbackSpeed: number;

  /** Total number of actions across all workflows */
  totalActions: number;

  /** Global action index (across all workflows) */
  globalActionIndex: number;
}

/**
 * Initial animation state
 */
export const INITIAL_ANIMATION_STATE: TransitionAnimationState = {
  phase: "idle",
  currentWorkflowIndex: 0,
  currentActionIndex: 0,
  progress: 0,
  isPlaying: false,
  playbackSpeed: 1,
  totalActions: 0,
  globalActionIndex: 0,
};

// ============================================================================
// Action Animation Configuration
// ============================================================================

/**
 * Visual action categories for animation styling
 */
export type ActionCategory =
  | "find" // FIND, VANISH, RAG_FIND
  | "mouse" // CLICK, MOUSE_MOVE, DRAG, etc.
  | "keyboard" // TYPE, KEY_PRESS, HOTKEY
  | "control" // IF, LOOP, SWITCH, TRY_CATCH
  | "data" // SET_VARIABLE, MAP, FILTER, etc.
  | "state" // GO_TO_STATE, RUN_WORKFLOW
  | "code" // CODE_BLOCK, CUSTOM_FUNCTION
  | "shell" // SHELL, SHELL_SCRIPT
  | "ai" // AI_PROMPT, etc.
  | "branch"; // Branch indicator (pseudo-action)

/**
 * Configuration for animating a single action
 */
export interface ActionAnimationConfig {
  /** Unique ID for this animation step */
  id: string;

  /** Original action ID */
  actionId: string;

  /** Action type */
  type: ActionType | "BRANCH_START" | "BRANCH_END";

  /** Action category for styling */
  category: ActionCategory;

  /** Human-readable action name */
  name: string;

  /** Animation duration in milliseconds */
  duration: number;

  /** Start position for animations (e.g., DRAG source) */
  startPosition?: { x: number; y: number };

  /** End position for animations (e.g., CLICK point, DRAG destination) */
  endPosition?: { x: number; y: number };

  /** Target region for FIND animations */
  targetRegion?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  /** Text content for TYPE animations */
  text?: string;

  /** Direction for SCROLL animations */
  direction?: "up" | "down" | "left" | "right";

  /** Target image ID for FIND actions */
  targetImageId?: string;

  /** Target state IDs for GO_TO_STATE */
  targetStateIds?: string[];

  /** Label for non-visual actions */
  label?: string;

  /** Number of branches (for BRANCH_START) */
  branchCount?: number;

  /** Branch labels (for IF: ["true", "false"], for SWITCH: case values) */
  branchLabels?: string[];
}

// ============================================================================
// Transition Visualization Data
// ============================================================================

/**
 * Complete data needed to visualize a transition
 */
export interface TransitionVisualizationData {
  /** The transition being visualized */
  transition: Transition;

  /** Origin states (states active before transition) */
  originStates: State[];

  /** Target states (states active after transition) */
  targetStates: State[];

  /** States that will be deactivated */
  deactivatedStates: State[];

  /** States that will be activated */
  activatedStates: State[];

  /** Workflows referenced by the transition */
  workflows: Workflow[];

  /** Flattened action sequence for animation */
  actionSequence: ActionAnimationConfig[];
}

// ============================================================================
// Animation Timing
// ============================================================================

/**
 * Default animation durations in milliseconds
 */
export const ANIMATION_DURATIONS: Record<ActionCategory | "phase", number> = {
  find: 800,
  mouse: 500,
  keyboard: 400, // Base duration, TYPE is per-character
  control: 300,
  data: 400,
  state: 600,
  code: 400,
  shell: 400,
  ai: 500,
  branch: 300,
  phase: 1000, // Duration for phase transitions (showing-initial, showing-final)
};

/**
 * Per-character duration for TYPE action
 */
export const TYPE_CHAR_DURATION = 50; // ms per character

/**
 * Delay between actions
 */
export const INTER_ACTION_DELAY = 200; // ms

// ============================================================================
// Playback Speeds
// ============================================================================

/**
 * Available playback speed options
 */
export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

// ============================================================================
// Action Type Helpers
// ============================================================================

/**
 * Map action types to their categories
 */
export function getActionCategory(type: ActionType | string): ActionCategory {
  switch (type) {
    case "FIND":
    case "VANISH":
    case "RAG_FIND":
      return "find";

    case "CLICK":
    case "MOUSE_MOVE":
    case "MOUSE_DOWN":
    case "MOUSE_UP":
    case "DRAG":
    case "SCROLL":
      return "mouse";

    case "TYPE":
    case "KEY_PRESS":
    case "KEY_DOWN":
    case "KEY_UP":
    case "HOTKEY":
      return "keyboard";

    case "IF":
    case "LOOP":
    case "BREAK":
    case "CONTINUE":
    case "SWITCH":
    case "TRY_CATCH":
      return "control";

    case "SET_VARIABLE":
    case "GET_VARIABLE":
    case "SORT":
    case "FILTER":
    case "MAP":
    case "REDUCE":
    case "STRING_OPERATION":
    case "MATH_OPERATION":
      return "data";

    case "GO_TO_STATE":
    case "RUN_WORKFLOW":
    case "SCREENSHOT":
      return "state";

    case "CODE_BLOCK":
    case "CUSTOM_FUNCTION":
      return "code";

    case "SHELL":
    case "SHELL_SCRIPT":
      return "shell";

    case "AI_PROMPT":
    case "RUN_PROMPT_SEQUENCE":
    case "CHECKPOINT_WORKFLOW":
      return "ai";

    case "BRANCH_START":
    case "BRANCH_END":
      return "branch";

    default:
      return "data"; // Default to data for unknown types
  }
}

/**
 * Check if an action type is a branching action (has multiple outputs)
 */
export function isBranchingAction(type: ActionType): boolean {
  return type === "IF" || type === "SWITCH" || type === "TRY_CATCH";
}

/**
 * Check if an action type has visual representation on canvas
 */
export function isVisualAction(type: ActionType): boolean {
  const visualTypes: ActionType[] = [
    "FIND",
    "VANISH",
    "RAG_FIND",
    "CLICK",
    "MOUSE_MOVE",
    "DRAG",
    "SCROLL",
    "TYPE",
    "GO_TO_STATE",
  ];
  return visualTypes.includes(type);
}

// ============================================================================
// Animation Colors
// ============================================================================

/**
 * Colors for different action categories
 */
export const ACTION_CATEGORY_COLORS: Record<
  ActionCategory,
  { primary: string; secondary: string; bg: string }
> = {
  find: {
    primary: "#22C55E", // Green
    secondary: "#4ADE80",
    bg: "rgba(34, 197, 94, 0.2)",
  },
  mouse: {
    primary: "#00D9FF", // Cyan
    secondary: "#67E8F9",
    bg: "rgba(0, 217, 255, 0.2)",
  },
  keyboard: {
    primary: "#FCD34D", // Yellow
    secondary: "#FDE68A",
    bg: "rgba(252, 211, 77, 0.2)",
  },
  control: {
    primary: "#A855F7", // Purple
    secondary: "#C084FC",
    bg: "rgba(168, 85, 247, 0.2)",
  },
  data: {
    primary: "#3B82F6", // Blue
    secondary: "#60A5FA",
    bg: "rgba(59, 130, 246, 0.2)",
  },
  state: {
    primary: "#F97316", // Orange
    secondary: "#FB923C",
    bg: "rgba(249, 115, 22, 0.2)",
  },
  code: {
    primary: "#EC4899", // Pink
    secondary: "#F472B6",
    bg: "rgba(236, 72, 153, 0.2)",
  },
  shell: {
    primary: "#6B7280", // Gray
    secondary: "#9CA3AF",
    bg: "rgba(107, 114, 128, 0.2)",
  },
  ai: {
    primary: "#8B5CF6", // Violet
    secondary: "#A78BFA",
    bg: "rgba(139, 92, 246, 0.2)",
  },
  branch: {
    primary: "#D946EF", // Fuchsia
    secondary: "#E879F9",
    bg: "rgba(217, 70, 239, 0.2)",
  },
};
