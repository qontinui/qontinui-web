/**
 * Shared types for action properties components.
 */

import type { ActionExpectations } from "@/lib/expectations/types";
import type { BaseActionSettings, ExecutionSettings } from "@/lib/action-schema/shared/timing-config";

export interface Action {
  id: string;
  type: // Pure mouse actions
    | "MOUSE_MOVE"
    | "MOUSE_DOWN"
    | "MOUSE_UP"
    | "MOUSE_SCROLL"
    // Pure keyboard actions
    | "KEY_DOWN"
    | "KEY_UP"
    | "KEY_PRESS"
    // Combined mouse actions
    | "CLICK"
    | "DOUBLE_CLICK"
    | "RIGHT_CLICK"
    | "DRAG"
    | "SCROLL"
    // Combined keyboard actions
    | "TYPE"
    // Find actions
    | "FIND"
    | "FIND_STATE_IMAGE"
    | "VANISH"
    | "GO_TO_STATE"
    | "RUN_WORKFLOW"
    // Control flow actions
    | "IF"
    | "LOOP"
    | "BREAK"
    | "CONTINUE"
    | "SWITCH"
    | "TRY_CATCH"
    // Data operation actions
    | "SET_VARIABLE"
    | "GET_VARIABLE"
    | "SORT"
    | "FILTER"
    | "MAP"
    | "REDUCE"
    | "STRING_OPERATION"
    | "MATH_OPERATION";
  config: Record<string, any>;
  /** Base settings (timing, logging, etc.) */
  base?: BaseActionSettings;
  /** Execution control (timeout, retries, etc.) */
  execution?: ExecutionSettings;
  /** Action-level expectations for checkpoint and failure behavior */
  expectations?: ActionExpectations;
}

export interface ActionPropertiesComponentProps {
  action: Action;
  updateConfig: (
    key: string,
    value: any,
    additionalUpdates?: Record<string, any>
  ) => void;
  images: any[];
  states: any[];
  processes: any[]; // Array of workflows (prop name "processes" for legacy compatibility)
  textAreaRef?: React.RefObject<HTMLTextAreaElement | null>;
  shouldOpenImageSelector?: boolean;
  onUpdateAction?: (action: Action) => void;
}
