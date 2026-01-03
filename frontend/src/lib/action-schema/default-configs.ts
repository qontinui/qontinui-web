/**
 * Default configuration values for all action types
 *
 * Provides type-safe default configs that match the schema definitions.
 * Used when creating new actions from palette or programmatically.
 */

import { ActionType, ActionConfigMap } from "./action-types";

/**
 * Get default configuration for a given action type
 */
export function getDefaultConfig<T extends ActionType>(
  type: T
): ActionConfigMap[T] {
  switch (type) {
    // ========================================================================
    // Find Actions
    // ========================================================================
    case "FIND":
      return {
        target: {
          type: "image",
          imageId: null as unknown,
        },
      } as ActionConfigMap[T];

    case "FIND_STATE":
      return {
        stateIds: [],
        outputVariable: "",
      } as unknown as ActionConfigMap[T];

    case "VANISH":
      return {
        target: {
          type: "image",
          imageId: null as unknown,
        },
        maxWaitTime: 5000,
        pollInterval: 500,
      } as ActionConfigMap[T];

    case "RAG_FIND":
      return {
        target: {
          type: "stateImage",
          stateImageId: "",
        },
        topK: 1,
        outputVariable: "",
      } as ActionConfigMap[T];

    // ========================================================================
    // Mouse Actions
    // ========================================================================
    case "CLICK":
      return {
        target: {
          type: "currentPosition",
        },
        mouseButton: "LEFT",
        numberOfClicks: 1,
      } as unknown as ActionConfigMap[T];

    case "MOUSE_MOVE":
      return {
        target: {
          type: "currentPosition",
        },
      } as ActionConfigMap[T];

    case "MOUSE_DOWN":
      return {
        button: "left",
      } as unknown as ActionConfigMap[T];

    case "MOUSE_UP":
      return {
        button: "left",
      } as unknown as ActionConfigMap[T];

    case "DRAG":
      return {
        from: {
          type: "currentPosition",
        },
        to: {
          type: "currentPosition",
        },
      } as unknown as ActionConfigMap[T];

    case "SCROLL":
      return {
        direction: "down",
        amount: 3,
      } as unknown as ActionConfigMap[T];

    // ========================================================================
    // Keyboard Actions
    // ========================================================================
    case "TYPE":
      return {
        text: "",
      } as ActionConfigMap[T];

    case "KEY_PRESS":
      return {
        key: "",
      } as unknown as ActionConfigMap[T];

    case "KEY_DOWN":
      return {
        key: "",
      } as unknown as ActionConfigMap[T];

    case "KEY_UP":
      return {
        key: "",
      } as unknown as ActionConfigMap[T];

    case "HOTKEY":
      return {
        keys: [],
      } as unknown as ActionConfigMap[T];

    // ========================================================================
    // Control Flow Actions
    // ========================================================================
    case "IF":
      return {
        condition: {
          type: "javascript",
          expression: "true",
        },
        thenBranch: [],
      } as unknown as ActionConfigMap[T];

    case "LOOP":
      return {
        loopType: "count",
        count: 10,
        body: [],
      } as unknown as ActionConfigMap[T];

    case "BREAK":
      return {} as ActionConfigMap[T];

    case "CONTINUE":
      return {} as ActionConfigMap[T];

    case "SWITCH":
      return {
        value: {
          type: "javascript",
          expression: "",
        },
        cases: [],
      } as unknown as ActionConfigMap[T];

    case "TRY_CATCH":
      return {
        tryBranch: [],
        catchBranch: [],
      } as unknown as ActionConfigMap[T];

    // ========================================================================
    // Data Actions
    // ========================================================================
    case "SET_VARIABLE":
      return {
        variableName: "",
        value: {
          type: "literal",
          value: "",
        },
      } as ActionConfigMap[T];

    case "GET_VARIABLE":
      return {
        variableName: "",
        outputVariable: "",
      } as ActionConfigMap[T];

    case "SORT":
      return {
        array: {
          type: "variable",
          variableName: "",
        },
        order: "ascending",
        outputVariable: "",
      } as unknown as ActionConfigMap[T];

    case "FILTER":
      return {
        array: {
          type: "variable",
          variableName: "",
        },
        condition: {
          type: "javascript",
          expression: "",
        },
        outputVariable: "",
      } as unknown as ActionConfigMap[T];

    case "MAP":
      return {
        array: {
          type: "variable",
          variableName: "",
        },
        transform: {
          type: "javascript",
          expression: "",
        },
        outputVariable: "",
      } as unknown as ActionConfigMap[T];

    case "REDUCE":
      return {
        array: {
          type: "variable",
          variableName: "",
        },
        reducer: {
          type: "javascript",
          expression: "",
        },
        initialValue: null,
        outputVariable: "",
      } as unknown as ActionConfigMap[T];

    case "STRING_OPERATION":
      return {
        operation: "concat",
        inputs: [],
        outputVariable: "",
      } as unknown as ActionConfigMap[T];

    case "MATH_OPERATION":
      return {
        operation: "add",
        operands: [],
        outputVariable: "",
      } as unknown as ActionConfigMap[T];

    // ========================================================================
    // State Actions
    // ========================================================================
    case "GO_TO_STATE":
      return {
        stateId: "",
      } as unknown as ActionConfigMap[T];

    case "RUN_WORKFLOW":
      return {
        workflowId: "",
      } as ActionConfigMap[T];

    case "SCREENSHOT":
      return {
        region: "fullscreen",
        outputVariable: "screenshot",
      } as unknown as ActionConfigMap[T];

    // ========================================================================
    // Code Actions
    // ========================================================================
    case "CODE_BLOCK":
      return {
        language: "javascript",
        code: "",
      } as unknown as ActionConfigMap[T];

    case "CUSTOM_FUNCTION":
      return {
        functionName: "",
        parameters: [],
      } as unknown as ActionConfigMap[T];

    // ========================================================================
    // Shell Actions
    // ========================================================================
    case "SHELL":
      return {
        command: "",
        shell: "bash",
        outputFormat: "text",
        timeout: 30000,
        failOnError: true,
      } as unknown as ActionConfigMap[T];

    case "SHELL_SCRIPT":
      return {
        script: "",
        shell: "bash",
        outputFormat: "text",
        timeout: 60000,
        failOnError: true,
      } as unknown as ActionConfigMap[T];

    // ========================================================================
    // AI Actions
    // ========================================================================
    case "AI_PROMPT":
      return {
        provider: "claude",
        prompt: "",
        freshContext: true,
        timeout: 600000,
        failOnError: true,
      } as unknown as ActionConfigMap[T];

    default:
      return {} as ActionConfigMap[T];
  }
}

/**
 * Check if an action config is valid (has required fields)
 */
export function isValidConfig<T extends ActionType>(
  type: T,
  config: unknown
): config is ActionConfigMap[T] {
  // Basic validation - could be expanded
  const configObj = config as Record<string, unknown> | null | undefined;

  switch (type) {
    case "FIND":
    case "VANISH": {
      const target = configObj?.target as Record<string, unknown> | undefined;
      return target?.type === "image";
    }

    case "TYPE":
      return typeof configObj?.text === "string";

    case "KEY_PRESS":
    case "KEY_DOWN":
    case "KEY_UP":
      return typeof configObj?.key === "string";

    default:
      return true; // Assume valid for other types
  }
}
