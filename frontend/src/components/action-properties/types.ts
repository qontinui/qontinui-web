/**
 * Shared types for action properties components.
 */

import type { ActionExpectations } from "@/lib/expectations/types";
import type {
  BaseActionSettings,
  ExecutionSettings,
} from "@/lib/action-schema/shared/timing-config";
import type { ImageAsset, State } from "@/contexts/automation-context/types";
import type { Workflow } from "@/lib/action-schema/action-types";

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
    | "RAG_FIND"
    | "VANISH"
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
    // Data operation actions
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
    | "CUSTOM_FUNCTION"
    // Shell actions
    | "SHELL"
    | "SHELL_SCRIPT"
    // AI actions
    | "AI_PROMPT"
    | "RUN_PROMPT_SEQUENCE"
    | "CHECKPOINT_WORKFLOW";
  config: Record<string, unknown>;
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
    value: unknown,
    additionalUpdates?: Record<string, unknown>
  ) => void;
  images: ImageAsset[];
  states: State[];
  processes: Workflow[]; // Array of workflows (prop name "processes" for legacy compatibility)
  textAreaRef?: React.RefObject<HTMLTextAreaElement | null>;
  shouldOpenImageSelector?: boolean;
  onUpdateAction?: (action: Action) => void;
}
