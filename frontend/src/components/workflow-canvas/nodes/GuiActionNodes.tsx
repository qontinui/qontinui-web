/**
 * GUI Action Node Components
 *
 * Custom nodes for GUI automation actions:
 * - Mouse actions: CLICK, DOUBLE_CLICK, RIGHT_CLICK, DRAG, SCROLL, etc.
 * - Keyboard actions: TYPE, KEY_PRESS, HOTKEY, etc.
 * - Find actions: FIND, VANISH, EXISTS, WAIT
 * - Screenshot actions: SCREENSHOT
 */

import React from "react";
import { NodeProps } from "@xyflow/react";
import { BaseNode, BaseNodeData, CompactNode } from "./BaseNode";
import type {
  ClickActionConfig,
  DoubleClickActionConfig,
  RightClickActionConfig,
  DragActionConfig,
  ScrollActionConfig,
  MouseMoveActionConfig,
} from "@/lib/action-schema/configs/mouse-actions";
import type {
  TypeActionConfig,
  KeyPressActionConfig,
  HotkeyActionConfig,
} from "@/lib/action-schema/configs/keyboard-actions";
import type {
  FindActionConfig,
  VanishActionConfig,
  ExistsActionConfig,
  WaitActionConfig,
} from "@/lib/action-schema/configs/find-actions";
import type { ScreenshotActionConfig } from "@/lib/action-schema/configs/state-actions";

// =============================================================================
// Mouse Action Nodes
// =============================================================================

/**
 * CLICK Node
 */
export function ClickNode(props: NodeProps<BaseNodeData>) {
  return (
    <BaseNode
      {...props}
      className="gui-action-node mouse-node click-node border-green-400"
    />
  );
}

/**
 * DOUBLE_CLICK Node
 */
export function DoubleClickNode(props: NodeProps<BaseNodeData>) {
  return (
    <BaseNode
      {...props}
      className="gui-action-node mouse-node double-click-node border-green-400"
    />
  );
}

/**
 * RIGHT_CLICK Node
 */
export function RightClickNode(props: NodeProps<BaseNodeData>) {
  return (
    <BaseNode
      {...props}
      className="gui-action-node mouse-node right-click-node border-green-400"
    />
  );
}

/**
 * MOUSE_MOVE Node
 */
export function MouseMoveNode(props: NodeProps<BaseNodeData>) {
  return (
    <CompactNode
      {...props}
      className="gui-action-node mouse-node mouse-move-node border-green-300"
    />
  );
}

/**
 * MOUSE_DOWN Node
 */
export function MouseDownNode(props: NodeProps<BaseNodeData>) {
  return (
    <CompactNode
      {...props}
      className="gui-action-node mouse-node mouse-down-node border-green-300"
    />
  );
}

/**
 * MOUSE_UP Node
 */
export function MouseUpNode(props: NodeProps<BaseNodeData>) {
  return (
    <CompactNode
      {...props}
      className="gui-action-node mouse-node mouse-up-node border-green-300"
    />
  );
}

/**
 * DRAG Node
 */
export function DragNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as DragActionConfig;

  return (
    <BaseNode
      {...props}
      className="gui-action-node mouse-node drag-node border-green-400"
    />
  );
}

/**
 * SCROLL Node
 */
export function ScrollNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as ScrollActionConfig;

  return (
    <BaseNode
      {...props}
      className="gui-action-node mouse-node scroll-node border-green-400"
    />
  );
}

// =============================================================================
// Keyboard Action Nodes
// =============================================================================

/**
 * TYPE Node
 */
export function TypeNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as TypeActionConfig;
  const text = config.text || "";
  const preview = text.length > 20 ? `${text.substring(0, 20)}...` : text;

  return (
    <BaseNode
      {...props}
      className="gui-action-node keyboard-node type-node border-cyan-400"
    />
  );
}

/**
 * KEY_PRESS Node
 */
export function KeyPressNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as KeyPressActionConfig;

  return (
    <BaseNode
      {...props}
      className="gui-action-node keyboard-node key-press-node border-cyan-400"
    />
  );
}

/**
 * KEY_DOWN Node
 */
export function KeyDownNode(props: NodeProps<BaseNodeData>) {
  return (
    <CompactNode
      {...props}
      className="gui-action-node keyboard-node key-down-node border-cyan-300"
    />
  );
}

/**
 * KEY_UP Node
 */
export function KeyUpNode(props: NodeProps<BaseNodeData>) {
  return (
    <CompactNode
      {...props}
      className="gui-action-node keyboard-node key-up-node border-cyan-300"
    />
  );
}

/**
 * HOTKEY Node
 */
export function HotkeyNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as HotkeyActionConfig;

  return (
    <BaseNode
      {...props}
      className="gui-action-node keyboard-node hotkey-node border-cyan-400"
    />
  );
}

// =============================================================================
// Find Action Nodes
// =============================================================================

/**
 * FIND Node
 */
export function FindNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as FindActionConfig;

  return (
    <BaseNode
      {...props}
      className="gui-action-node find-node border-amber-400"
    />
  );
}

/**
 * FIND_STATE_IMAGE Node
 */
export function FindStateImageNode(props: NodeProps<BaseNodeData>) {
  return (
    <BaseNode
      {...props}
      className="gui-action-node find-node find-state-image-node border-amber-400"
    />
  );
}

/**
 * VANISH Node
 */
export function VanishNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as VanishActionConfig;

  return (
    <BaseNode
      {...props}
      className="gui-action-node find-node vanish-node border-amber-400"
    />
  );
}

/**
 * EXISTS Node
 */
export function ExistsNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as ExistsActionConfig;

  return (
    <BaseNode
      {...props}
      className="gui-action-node find-node exists-node border-amber-400"
    />
  );
}

/**
 * WAIT Node
 */
export function WaitNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as WaitActionConfig;
  const duration = config.duration || 1000;

  return (
    <CompactNode
      {...props}
      className="gui-action-node find-node wait-node border-amber-300"
    />
  );
}

// =============================================================================
// Screenshot Node
// =============================================================================

/**
 * SCREENSHOT Node
 */
export function ScreenshotNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as ScreenshotActionConfig;

  return (
    <BaseNode
      {...props}
      className="gui-action-node screenshot-node border-violet-400"
    />
  );
}

/**
 * Export all GUI action nodes
 */
export const GuiActionNodes = {
  // Mouse actions
  CLICK: ClickNode,
  DOUBLE_CLICK: DoubleClickNode,
  RIGHT_CLICK: RightClickNode,
  MOUSE_MOVE: MouseMoveNode,
  MOUSE_DOWN: MouseDownNode,
  MOUSE_UP: MouseUpNode,
  DRAG: DragNode,
  SCROLL: ScrollNode,

  // Keyboard actions
  TYPE: TypeNode,
  KEY_PRESS: KeyPressNode,
  KEY_DOWN: KeyDownNode,
  KEY_UP: KeyUpNode,
  HOTKEY: HotkeyNode,

  // Find actions
  FIND: FindNode,
  FIND_STATE_IMAGE: FindStateImageNode,
  VANISH: VanishNode,
  EXISTS: ExistsNode,
  WAIT: WaitNode,

  // Screenshot
  SCREENSHOT: ScreenshotNode,
};
