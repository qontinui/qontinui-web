/**
 * Action property components export and registration.
 */

import { actionConfigRegistry } from "../ActionConfigRegistry";

// Import all action property components
export { FindActionProperties } from "./FindActionProperties";
export { RagFindActionProperties } from "./RagFindActionProperties";
export { ClickActionProperties } from "./ClickActionProperties";
export {
  MouseMoveProperties,
  MouseButtonProperties,
} from "./MouseActionProperties";
export { KeyboardActionProperties } from "./KeyboardActionProperties";
export { DragActionProperties } from "./DragActionProperties";
export { TypeActionProperties } from "./TypeActionProperties";
export { ScrollActionProperties } from "./ScrollActionProperties";
export { VanishActionProperties } from "./VanishActionProperties";
export { GoToStateActionProperties } from "./GoToStateActionProperties";
export { RunWorkflowActionProperties } from "./RunWorkflowActionProperties";
export { ScreenshotActionProperties } from "./ScreenshotActionProperties";

// Import Phase 1 components
export { GetVariableActionProperties } from "./data-operations/GetVariableActionProperties";
export { BreakActionProperties } from "./control-flow/BreakActionProperties";
export { ContinueActionProperties } from "./control-flow/ContinueActionProperties";
export { IfActionProperties } from "./control-flow/IfActionProperties";
export { LoopActionProperties } from "./control-flow/LoopActionProperties";

// Import Code Execution components
export { CodeBlockActionProperties } from "./code-execution/CodeBlockActionProperties";

// Import Shell Execution components
export {
  ShellActionProperties,
  ShellScriptActionProperties,
} from "./shell/ShellActionProperties";

// Import AI Prompt components
export { AIPromptActionProperties } from "./ai-prompts/AIPromptActionProperties";

// Register components with the registry
import { FindActionProperties } from "./FindActionProperties";
import { RagFindActionProperties } from "./RagFindActionProperties";
import { ClickActionProperties } from "./ClickActionProperties";
import {
  MouseMoveProperties,
  MouseButtonProperties,
} from "./MouseActionProperties";
import { KeyboardActionProperties } from "./KeyboardActionProperties";
import { DragActionProperties } from "./DragActionProperties";
import { TypeActionProperties } from "./TypeActionProperties";
import { ScrollActionProperties } from "./ScrollActionProperties";
import { VanishActionProperties } from "./VanishActionProperties";
import { GoToStateActionProperties } from "./GoToStateActionProperties";
import { RunWorkflowActionProperties } from "./RunWorkflowActionProperties";
import { ScreenshotActionProperties } from "./ScreenshotActionProperties";

// Import Phase 1 components
import { GetVariableActionProperties } from "./data-operations/GetVariableActionProperties";
import { BreakActionProperties } from "./control-flow/BreakActionProperties";
import { ContinueActionProperties } from "./control-flow/ContinueActionProperties";
import { IfActionProperties } from "./control-flow/IfActionProperties";
import { LoopActionProperties } from "./control-flow/LoopActionProperties";

// Import Code Execution components
import { CodeBlockActionProperties } from "./code-execution/CodeBlockActionProperties";

// Import Shell Execution components
import {
  ShellActionProperties,
  ShellScriptActionProperties,
} from "./shell/ShellActionProperties";

// Import AI Prompt components
import { AIPromptActionProperties } from "./ai-prompts/AIPromptActionProperties";

// Register all action types with their components
actionConfigRegistry.register("FIND", FindActionProperties, "FIND");
actionConfigRegistry.register("RAG_FIND", RagFindActionProperties, "RAG_FIND");
actionConfigRegistry.register("CLICK", ClickActionProperties, "CLICK");
actionConfigRegistry.register("MOUSE_MOVE", MouseMoveProperties, "MOUSE_MOVE");
actionConfigRegistry.registerMultiple(
  ["MOUSE_DOWN", "MOUSE_UP"],
  MouseButtonProperties,
  "MOUSE_DOWN/MOUSE_UP"
);
actionConfigRegistry.registerMultiple(
  ["KEY_PRESS", "KEY_DOWN", "KEY_UP"],
  KeyboardActionProperties,
  "KEY_PRESS/KEY_DOWN/KEY_UP"
);
actionConfigRegistry.register("DRAG", DragActionProperties, "DRAG");
actionConfigRegistry.register("TYPE", TypeActionProperties, "TYPE");
actionConfigRegistry.register("SCROLL", ScrollActionProperties, "SCROLL");
actionConfigRegistry.register("VANISH", VanishActionProperties, "VANISH");
actionConfigRegistry.register(
  "GO_TO_STATE",
  GoToStateActionProperties,
  "GO_TO_STATE"
);
actionConfigRegistry.register(
  "RUN_WORKFLOW",
  RunWorkflowActionProperties,
  "RUN_WORKFLOW"
);
actionConfigRegistry.register(
  "SCREENSHOT",
  ScreenshotActionProperties,
  "SCREENSHOT"
);

// Register Phase 1 components
actionConfigRegistry.register(
  "GET_VARIABLE",
  GetVariableActionProperties,
  "GET_VARIABLE"
);
actionConfigRegistry.register("BREAK", BreakActionProperties, "BREAK");
actionConfigRegistry.register("CONTINUE", ContinueActionProperties, "CONTINUE");
actionConfigRegistry.register("IF", IfActionProperties, "IF");
actionConfigRegistry.register("LOOP", LoopActionProperties, "LOOP");

// Register Code Execution components
actionConfigRegistry.register(
  "CODE_BLOCK",
  CodeBlockActionProperties,
  "CODE_BLOCK"
);

// Register Shell Execution components
actionConfigRegistry.register("SHELL", ShellActionProperties, "SHELL");
actionConfigRegistry.register(
  "SHELL_SCRIPT",
  ShellScriptActionProperties,
  "SHELL_SCRIPT"
);

// Register AI Prompt components
actionConfigRegistry.register(
  "AI_PROMPT",
  AIPromptActionProperties,
  "AI_PROMPT"
);
