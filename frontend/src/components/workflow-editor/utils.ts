/**
 * Pure utility functions for the Sequential List View.
 *
 * - buildActionTree: converts flat action list into a nested tree
 * - getActionIcon: maps action type to display icon
 * - getActionSummary: generates human-readable summary for an action
 */

import type { Action } from "@/lib/action-schema/action-types";
import type { ActionTreeNode } from "./types";

// ============================================================================
// Action Tree Builder
// ============================================================================

export function buildActionTree(
  actions: Action[],
  expandedActions: Set<string>
): ActionTreeNode[] {
  const tree: ActionTreeNode[] = [];
  let index = 0;

  function processAction(action: Action, level: number): ActionTreeNode {
    const node: ActionTreeNode = {
      action,
      index: index++,
      level,
      collapsed: !expandedActions.has(action.id),
    };

    const config = action.config as Record<string, unknown>;

    // Check for nested actions
    if (action.type === "IF") {
      const children: ActionTreeNode[] = [];

      // Then branch
      const thenActions = config.thenActions as Action[] | undefined;
      if (thenActions && Array.isArray(thenActions)) {
        children.push(
          ...thenActions.map((a: Action) => processAction(a, level + 1))
        );
      }

      // Else branch
      const elseActions = config.elseActions as Action[] | undefined;
      if (elseActions && Array.isArray(elseActions)) {
        children.push(
          ...elseActions.map((a: Action) => processAction(a, level + 1))
        );
      }

      if (children.length > 0) {
        node.children = children;
      }
    } else if (action.type === "LOOP") {
      const loopActions = config.loopActions as Action[] | undefined;
      if (loopActions && Array.isArray(loopActions)) {
        node.children = loopActions.map((a: Action) =>
          processAction(a, level + 1)
        );
      }
    } else if (action.type === "TRY_CATCH") {
      const children: ActionTreeNode[] = [];

      const tryActions = config.tryActions as Action[] | undefined;
      if (tryActions && Array.isArray(tryActions)) {
        children.push(
          ...tryActions.map((a: Action) => processAction(a, level + 1))
        );
      }

      const catchActions = config.catchActions as Action[] | undefined;
      if (catchActions && Array.isArray(catchActions)) {
        children.push(
          ...catchActions.map((a: Action) => processAction(a, level + 1))
        );
      }

      if (children.length > 0) {
        node.children = children;
      }
    }

    return node;
  }

  for (const action of actions) {
    tree.push(processAction(action, 0));
  }

  return tree;
}

// ============================================================================
// Action Display Helpers
// ============================================================================

export function getActionIcon(type: string): string {
  const icons: Record<string, string> = {
    CLICK: "\uD83D\uDDB1\uFE0F",
    TYPE: "\u2328\uFE0F",
    SCREENSHOT: "\uD83D\uDCF7",
    IF: "\uD83D\uDD00",
    LOOP: "\uD83D\uDD01",
    TRY_CATCH: "\u26A0\uFE0F",
    SWITCH: "\uD83D\uDD00",
    FIND: "\uD83D\uDD0D",
    VANISH: "\uD83D\uDC7B",
    RAG_FIND: "\uD83D\uDD2E",
    GET_VARIABLE: "\uD83D\uDCE5",
    SET_VARIABLE: "\uD83D\uDCE4",
    FILTER: "\uD83D\uDD3D",
    MAP: "\uD83D\uDDFA\uFE0F",
    REDUCE: "\u2699\uFE0F",
  };
  return icons[type] || "\u2022";
}

export function getActionSummary(action: Action): string {
  if (action.name) {
    return action.name;
  }

  // Generate summary based on action type and config
  const config = action.config as Record<string, unknown>;

  switch (action.type) {
    case "CLICK": {
      const target = config.target as
        | { image?: string; selector?: string }
        | undefined;
      if (target?.image) {
        return `Click "${target.image}"`;
      } else if (target?.selector) {
        return `Click "${target.selector}"`;
      }
      return "Click element";
    }

    case "TYPE": {
      const text = config.text as string | undefined;
      if (text) {
        const truncated =
          text.length > 30 ? text.substring(0, 30) + "..." : text;
        return `Type "${truncated}"`;
      }
      return "Type text";
    }

    case "SCREENSHOT": {
      const filename = config.filename as string | undefined;
      return filename ? `Screenshot "${filename}"` : "Take screenshot";
    }

    case "IF":
      return "If condition";

    case "LOOP": {
      const iterations = config.iterations as number | undefined;
      return iterations ? `Loop ${iterations} times` : "Loop";
    }

    case "TRY_CATCH":
      return "Try-Catch block";

    case "FIND":
      return "Find element";

    case "VANISH":
      return "Wait for element to vanish";

    case "RAG_FIND":
      return "RAG Find element";

    case "GET_VARIABLE": {
      const getVar = config.variable as string | undefined;
      return getVar ? `Get "${getVar}"` : "Get variable";
    }

    case "SET_VARIABLE": {
      const setVar = config.variable as string | undefined;
      return setVar ? `Set "${setVar}"` : "Set variable";
    }

    case "FILTER":
      return "Filter data";

    case "MAP":
      return "Map/Transform data";

    case "REDUCE":
      return "Reduce data";

    default:
      return action.type;
  }
}
