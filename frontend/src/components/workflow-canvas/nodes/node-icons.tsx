/**
 * Node Icons System
 *
 * Icon components for each action type using Lucide React icons.
 * Provides consistent sizing and styling across all node types.
 */

import React from "react";
import {
  MousePointer,
  MousePointerClick,
  Keyboard,
  Type,
  Hand,
  Move,
  ArrowDown,
  ArrowUp,
  EyeOff,
  Search,
  Sparkles,
  Camera,
  GitBranch,
  Repeat,
  SkipForward,
  GitMerge,
  AlertTriangle,
  Variable,
  Database,
  Filter,
  Map,
  Shuffle,
  ArrowUpDown,
  Calculator,
  TextCursor,
  Circle,
  Play,
  StopCircle,
  MessageSquare,
  Folder,
  Settings,
  Zap,
  Box,
  Code,
  FileCode,
  Terminal,
  FileTerminal,
  LucideIcon,
} from "lucide-react";
import { ActionType } from "@/lib/action-schema/action-types";

/**
 * Icon component props
 */
export interface NodeIconProps {
  className?: string;
  size?: number;
}

/**
 * Map of action types to their icon components
 */
const ACTION_ICONS: Record<ActionType, LucideIcon> = {
  // Find Actions
  FIND: Search,
  VANISH: EyeOff,
  RAG_FIND: Sparkles,

  // Mouse Actions
  CLICK: MousePointerClick,
  MOUSE_MOVE: Move,
  MOUSE_DOWN: ArrowDown,
  MOUSE_UP: ArrowUp,
  DRAG: Hand,
  SCROLL: ArrowUpDown,

  // Keyboard Actions
  TYPE: Type,
  KEY_PRESS: Keyboard,
  KEY_DOWN: ArrowDown,
  KEY_UP: ArrowUp,
  HOTKEY: Keyboard,

  // Control Flow Actions
  IF: GitBranch,
  LOOP: Repeat,
  BREAK: StopCircle,
  CONTINUE: SkipForward,
  SWITCH: GitMerge,
  TRY_CATCH: AlertTriangle,

  // Data Actions
  SET_VARIABLE: Variable,
  GET_VARIABLE: Database,
  SORT: ArrowUpDown,
  FILTER: Filter,
  MAP: Map,
  REDUCE: Shuffle,
  STRING_OPERATION: TextCursor,
  MATH_OPERATION: Calculator,

  // State Actions
  GO_TO_STATE: Zap,
  RUN_WORKFLOW: Play,
  SCREENSHOT: Camera,

  // Code Actions
  CODE_BLOCK: Code,
  CUSTOM_FUNCTION: FileCode,

  // Shell Actions
  SHELL: Terminal,
  SHELL_SCRIPT: FileTerminal,

  // AI Actions
  AI_PROMPT: Sparkles,
};

/**
 * Get icon component for action type
 */
export function getNodeIcon(actionType: ActionType): LucideIcon {
  return ACTION_ICONS[actionType] || Box;
}

/**
 * Render icon for action type
 */
export function NodeIcon({
  actionType,
  className = "",
  size = 16,
}: {
  actionType: ActionType;
} & NodeIconProps) {
  const Icon = getNodeIcon(actionType);
  return <Icon className={className} size={size} />;
}

/**
 * Icon components for special node types
 */
export const SpecialIcons = {
  Start: Play,
  End: StopCircle,
  Comment: MessageSquare,
  Group: Folder,
  Merge: GitMerge,
};

/**
 * Category-specific icon sets
 */
export const CategoryIcons = {
  find: Search,
  mouse: MousePointer,
  keyboard: Keyboard,
  controlFlow: GitBranch,
  data: Database,
  state: Settings,
  special: Circle,
};

/**
 * Icon size presets
 */
export const IconSizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
} as const;

/**
 * Get icon by category
 */
export function getCategoryIcon(
  category:
    | "find"
    | "mouse"
    | "keyboard"
    | "controlFlow"
    | "data"
    | "state"
    | "special"
): LucideIcon {
  return CategoryIcons[category];
}

/**
 * Execution state icons
 */
export const ExecutionStateIcons = {
  running: Play,
  completed: Circle,
  failed: AlertTriangle,
  skipped: SkipForward,
  idle: Circle,
};

/**
 * Get execution state icon
 */
export function getExecutionStateIcon(
  state: "running" | "completed" | "failed" | "skipped" | "idle"
): LucideIcon {
  return ExecutionStateIcons[state];
}
