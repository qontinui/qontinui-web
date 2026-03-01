/**
 * useContextMenu Hook - Manages context menu state and generation
 *
 * Coordinates between canvas store actions and menu item builders
 * to produce context-aware menus for canvas, node, edge, and multi-select targets.
 */

"use client";

import { useCallback, useState } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import type { ContextMenuState } from "../context-menu-types";
import {
  buildCanvasMenuItems,
  buildNodeMenuItems,
  buildEdgeMenuItems,
  buildMultiSelectMenuItems,
} from "../context-menu-items";

export function useContextMenu() {
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);

  const {
    clipboardNodes,
    copy,
    paste,
    cut,
    duplicate,
    deleteActions,
    selectAll,
    toggleGrid,
    toggleSnapToGrid,
  } = useCanvasStore();

  const closeMenu = useCallback(() => {
    setMenuState(null);
  }, []);

  const openCanvasMenu = useCallback(
    (position: { x: number; y: number }) => {
      const items = buildCanvasMenuItems(position, {
        clipboardNodes,
        paste,
        selectAll,
        toggleGrid,
        toggleSnapToGrid,
      });

      setMenuState({
        type: "canvas",
        position,
        items,
      });
    },
    [clipboardNodes, paste, selectAll, toggleGrid, toggleSnapToGrid]
  );

  const openNodeMenu = useCallback(
    (position: { x: number; y: number }, nodeId: string) => {
      const items = buildNodeMenuItems(nodeId, {
        copy,
        cut,
        duplicate,
        deleteActions,
      });

      setMenuState({
        type: "node",
        position,
        items,
        nodeId,
      });
    },
    [copy, cut, duplicate, deleteActions]
  );

  const openEdgeMenu = useCallback(
    (position: { x: number; y: number }, edgeId: string) => {
      const items = buildEdgeMenuItems(edgeId);

      setMenuState({
        type: "edge",
        position,
        items,
        edgeId,
      });
    },
    []
  );

  const openMultiSelectMenu = useCallback(
    (position: { x: number; y: number }, nodeIds: string[]) => {
      const items = buildMultiSelectMenuItems(nodeIds, {
        copy,
        duplicate,
        deleteActions,
      });

      setMenuState({
        type: "multi-select",
        position,
        items,
        selectedNodeIds: nodeIds,
      });
    },
    [copy, duplicate, deleteActions]
  );

  return {
    menuState,
    openCanvasMenu,
    openNodeMenu,
    openEdgeMenu,
    openMultiSelectMenu,
    closeMenu,
  };
}
