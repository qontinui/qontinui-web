/**
 * SequentialEditor - Utility Functions & Constants
 *
 * Pure functions and constants for the SequentialEditor component.
 * No hooks or setState — only data transformations.
 */

import type { Action } from "@/lib/action-schema/action-types";

// Re-export getActionSummary from its dedicated file
export { getActionSummary } from "./action-summary-utils";

export const ACTION_GROUPS = {
  Find: [
    { type: "FIND", label: "Find Element", color: "bg-blue-500" },
    {
      type: "FIND",
      label: "Find State",
      color: "bg-cyan-500",
      preset: "stateImage",
    },
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
  Variables: [
    { type: "SET_VARIABLE", label: "Set Variable", color: "bg-emerald-500" },
    { type: "GET_VARIABLE", label: "Get Variable", color: "bg-emerald-600" },
  ],
  Verification: [
    { type: "VANISH", label: "Wait for Vanish", color: "bg-red-500" },
  ],
  Shell: [
    { type: "SHELL", label: "Run Command", color: "bg-slate-500" },
    { type: "SHELL_SCRIPT", label: "Run Script", color: "bg-slate-600" },
  ],
  AI: [{ type: "AI_PROMPT", label: "AI Prompt", color: "bg-violet-500" }],
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
      };
    case "CLICK":
      return {
        target: "Last Find Result",
        mouseButton: "LEFT",
        numberOfClicks: 1,
        hold_duration: 0,
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
      };
    case "DRAG":
      return {
        from: "Last Find Result",
        to: null,
        drag_duration: 1000,
        smooth_movement: true,
      };
    case "SCROLL":
      return {
        direction: "down",
        amount: 3,
        scroll_duration: 500,
        smooth_scroll: true,
      };
    case "VANISH":
      return {
        target: {
          type: "image",
          imageId: null,
        },
        maxWaitTime: 5000,
        pollInterval: 500,
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
      return { stateIds: [] }; // Array of state IDs for multi-target pathfinding
    case "RUN_WORKFLOW":
      return { workflowId: "" };
    case "IF":
      return {
        condition: {
          type: "variable",
          variableName: "",
          operator: "==",
          expectedValue: "",
        },
        thenActions: [],
      };
    case "LOOP":
      return {
        loopType: "FOR",
        iterations: 10,
        actions: [],
        maxIterations: 1000,
        breakOnError: false,
      };
    case "MOUSE_MOVE":
      return { target: "Last Find Result", x: 0, y: 0, duration: 0 };
    case "MOUSE_DOWN":
      return { button: "left", target: null };
    case "MOUSE_UP":
      return { button: "left", target: null };
    case "KEY_PRESS":
      return { key: "" };
    case "KEY_DOWN":
      return { key: "" };
    case "KEY_UP":
      return { key: "" };
    case "SHELL":
      return {
        command: "",
        shell: "bash",
        outputFormat: "text",
        timeout: 30000,
        failOnError: true,
      };
    case "SHELL_SCRIPT":
      return {
        script: "",
        shell: "bash",
        outputFormat: "text",
        timeout: 60000,
        failOnError: true,
      };
    case "AI_PROMPT":
      return {
        provider: "claude",
        prompt: "",
        freshContext: true,
        timeout: 600000,
        failOnError: true,
      };
    default:
      return {};
  }
}
