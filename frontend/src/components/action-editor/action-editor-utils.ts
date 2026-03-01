import type { Action } from "./action-editor-types";

export const ACTION_GROUPS = {
  Find: [
    { type: "FIND", label: "Find Element", color: "bg-blue-500" },
    { type: "FIND_STATE", label: "Find State", color: "bg-cyan-500" },
    { type: "RAG_FIND", label: "RAG Find", color: "bg-violet-500" },
  ],
  Mouse: [
    { type: "CLICK", label: "Click", color: "bg-green-500" },
    { type: "DOUBLE_CLICK", label: "Double Click", color: "bg-green-600" },
    { type: "RIGHT_CLICK", label: "Right Click", color: "bg-green-700" },
    { type: "DRAG", label: "Drag & Drop", color: "bg-purple-500" },
    { type: "SCROLL", label: "Scroll", color: "bg-orange-500" },
    { type: "MOUSE_MOVE", label: "Mouse Move", color: "bg-teal-500" },
    { type: "MOUSE_DOWN", label: "Mouse Down", color: "bg-teal-600" },
    { type: "MOUSE_UP", label: "Mouse Up", color: "bg-teal-700" },
  ],
  Keyboard: [
    { type: "TYPE", label: "Type Text", color: "bg-yellow-500" },
    { type: "KEY_PRESS", label: "Key Press", color: "bg-amber-500" },
    { type: "KEY_DOWN", label: "Key Down", color: "bg-amber-600" },
    { type: "KEY_UP", label: "Key Up", color: "bg-amber-700" },
  ],
  "Control Flow": [
    { type: "IF", label: "If/Else", color: "bg-blue-500" },
    { type: "LOOP", label: "Loop", color: "bg-purple-500" },
    { type: "GO_TO_STATE", label: "Go to State", color: "bg-indigo-500" },
    { type: "RUN_WORKFLOW", label: "Run Workflow", color: "bg-pink-500" },
  ],
  Verification: [
    { type: "VANISH", label: "Wait for Vanish", color: "bg-red-500" },
  ],
} as const;

// Flat list for finding action types by type
export const ACTION_TYPES = Object.values(ACTION_GROUPS).flat();

export function getDefaultConfig(
  type: Action["type"]
): Record<string, unknown> {
  switch (type) {
    case "FIND":
      return {
        target: {
          type: "image",
          imageId: null,
        },
        // similarity, strategy, pause_before_begin, pause_after_end are optional overrides
      };
    case "FIND_STATE":
      return {
        stateIds: [],
        outputVariable: "",
        // searchOptions are optional overrides
      };
    case "CLICK":
      return {
        target: "Last Find Result",
        mouseButton: "LEFT",
        numberOfClicks: 1,
        hold_duration: 0,
        // pause_before_begin, pause_after_end are optional overrides
      };
    case "TYPE":
      return {
        text: "",
        textSource: "stateString",
        selectedState: null,
        selectedStateStrings: [],
        typing_delay: 50,
        clear_before: false,
        press_enter: false,
        // pause_before_begin, pause_after_end are optional overrides
      };
    case "DRAG":
      return {
        from: "Last Find Result",
        to: null,
        drag_duration: 1000,
        smooth_movement: true,
        // pause_before_begin, pause_after_end are optional overrides
      };
    case "SCROLL":
      return {
        direction: "down",
        amount: 3,
        scroll_duration: 500,
        smooth_scroll: true,
        // pause_before_begin, pause_after_end are optional overrides
      };
    case "VANISH":
      return {
        target: {
          type: "image",
          imageId: null,
        },
        maxWaitTime: 5000,
        pollInterval: 500,
        // pause_before_begin, pause_after_end are optional overrides
      };
    case "RAG_FIND":
      return {
        target: {
          type: "stateImage",
          stateImageId: "",
        },
        topK: 1,
        outputVariable: "",
      };
    case "GO_TO_STATE":
      return {
        stateIds: [], // Array of state IDs for multi-target pathfinding
        // pause_before_begin, pause_after_end are optional overrides
      };
    case "RUN_WORKFLOW":
      return {
        process: null,
        // pause_before_begin, pause_after_end are optional overrides
      };
    case "IF":
      return {
        condition: {
          type: "variable",
          variableName: "",
          operator: "==",
          expectedValue: "",
        },
        thenActions: [],
        // elseActions is optional
      };
    case "LOOP":
      return {
        loopType: "FOR",
        iterations: 10,
        actions: [],
        maxIterations: 1000,
        breakOnError: false,
      };

    // Pure mouse actions
    case "MOUSE_MOVE":
      return {
        target: "Last Find Result",
        x: 0,
        y: 0,
        duration: 0,
        // Optional timing overrides: move_default_duration
      };
    case "MOUSE_DOWN":
      return {
        button: "left",
        target: null, // Optional - can press at current position
        // No timing overrides needed (instantaneous)
      };
    case "MOUSE_UP":
      return {
        button: "left",
        target: null, // Optional - can release at current position
        // No timing overrides needed (instantaneous)
      };

    // Combined actions with timing overrides
    case "DOUBLE_CLICK":
      return {
        target: "Last Find Result",
        mouseButton: "LEFT",
        // Optional timing overrides: click_hold_duration, double_click_interval, etc.
      };
    case "RIGHT_CLICK":
      return {
        target: "Last Find Result",
        // Optional timing overrides: click_hold_duration, click_release_delay, etc.
      };

    // Pure keyboard actions
    case "KEY_PRESS":
      return {
        key: "",
        // Optional timing overrides: key_hold_duration, key_release_delay
      };
    case "KEY_DOWN":
      return {
        key: "",
        // No timing overrides needed (instantaneous press)
      };
    case "KEY_UP":
      return {
        key: "",
        // No timing overrides needed (instantaneous release)
      };

    default:
      return {};
  }
}
