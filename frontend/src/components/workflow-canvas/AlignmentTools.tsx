/**
 * Alignment Tools - Align and distribute selected nodes
 *
 * Tools:
 * - Align Left/Right/Top/Bottom/Center
 * - Distribute Horizontally/Vertically
 * - Distribute Evenly
 * - Match Width/Height
 * - Smart Guides (snap to aligned positions)
 */

"use client";

import React from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { CanvasNode } from "./canvas-types";

// ============================================================================
// Types
// ============================================================================

export type AlignmentType =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "center-horizontal"
  | "center-vertical";

export type DistributionType = "horizontal" | "vertical" | "even";

export interface AlignmentToolsProps {
  nodeIds: string[];
  onAlign?: (type: AlignmentType) => void;
  onDistribute?: (type: DistributionType) => void;
}

// ============================================================================
// Alignment Utilities
// ============================================================================

export function alignNodes(
  nodes: CanvasNode[],
  type: AlignmentType
): { actionId: string; position: [number, number] }[] {
  if (nodes.length < 2) return [];

  const updates: { actionId: string; position: [number, number] }[] = [];

  switch (type) {
    case "left": {
      const minX = Math.min(...nodes.map((n) => n.position.x));
      nodes.forEach((node) => {
        updates.push({
          actionId: node.id,
          position: [minX, node.position.y],
        });
      });
      break;
    }

    case "right": {
      const maxX = Math.max(...nodes.map((n) => n.position.x));
      nodes.forEach((node) => {
        updates.push({
          actionId: node.id,
          position: [maxX, node.position.y],
        });
      });
      break;
    }

    case "top": {
      const minY = Math.min(...nodes.map((n) => n.position.y));
      nodes.forEach((node) => {
        updates.push({
          actionId: node.id,
          position: [node.position.x, minY],
        });
      });
      break;
    }

    case "bottom": {
      const maxY = Math.max(...nodes.map((n) => n.position.y));
      nodes.forEach((node) => {
        updates.push({
          actionId: node.id,
          position: [node.position.x, maxY],
        });
      });
      break;
    }

    case "center-horizontal": {
      const centerX =
        nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
      nodes.forEach((node) => {
        updates.push({
          actionId: node.id,
          position: [centerX, node.position.y],
        });
      });
      break;
    }

    case "center-vertical": {
      const centerY =
        nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length;
      nodes.forEach((node) => {
        updates.push({
          actionId: node.id,
          position: [node.position.x, centerY],
        });
      });
      break;
    }
  }

  return updates;
}

export function distributeNodes(
  nodes: CanvasNode[],
  type: DistributionType
): { actionId: string; position: [number, number] }[] {
  if (nodes.length < 3) return [];

  const updates: { actionId: string; position: [number, number] }[] = [];
  const sortedNodes = [...nodes];

  switch (type) {
    case "horizontal": {
      sortedNodes.sort((a, b) => a.position.x - b.position.x);
      const firstNode = sortedNodes[0];
      const lastNode = sortedNodes[sortedNodes.length - 1];
      if (!firstNode || !lastNode) break;

      const minX = firstNode.position.x;
      const maxX = lastNode.position.x;
      const spacing = (maxX - minX) / (sortedNodes.length - 1);

      sortedNodes.forEach((node, index) => {
        updates.push({
          actionId: node.id,
          position: [minX + spacing * index, node.position.y],
        });
      });
      break;
    }

    case "vertical": {
      sortedNodes.sort((a, b) => a.position.y - b.position.y);
      const firstNode = sortedNodes[0];
      const lastNode = sortedNodes[sortedNodes.length - 1];
      if (!firstNode || !lastNode) break;

      const minY = firstNode.position.y;
      const maxY = lastNode.position.y;
      const spacing = (maxY - minY) / (sortedNodes.length - 1);

      sortedNodes.forEach((node, index) => {
        updates.push({
          actionId: node.id,
          position: [node.position.x, minY + spacing * index],
        });
      });
      break;
    }

    case "even": {
      // Distribute evenly in both directions
      sortedNodes.sort((a, b) => a.position.x - b.position.x);
      const firstNodeX = sortedNodes[0];
      const lastNodeX = sortedNodes[sortedNodes.length - 1];
      if (!firstNodeX || !lastNodeX) break;

      const minX = firstNodeX.position.x;
      const maxX = lastNodeX.position.x;
      const spacingX = (maxX - minX) / (sortedNodes.length - 1);

      sortedNodes.sort((a, b) => a.position.y - b.position.y);
      const firstNodeY = sortedNodes[0];
      const lastNodeY = sortedNodes[sortedNodes.length - 1];
      if (!firstNodeY || !lastNodeY) break;

      const minY = firstNodeY.position.y;
      const maxY = lastNodeY.position.y;
      const spacingY = (maxY - minY) / (sortedNodes.length - 1);

      sortedNodes.forEach((node, index) => {
        updates.push({
          actionId: node.id,
          position: [minX + spacingX * index, minY + spacingY * index],
        });
      });
      break;
    }
  }

  return updates;
}

// ============================================================================
// Alignment Tools Component
// ============================================================================

export function AlignmentTools({
  nodeIds,
  onAlign,
  onDistribute,
}: AlignmentToolsProps) {
  const { workflow, moveActions } = useCanvasStore();

  const handleAlign = (type: AlignmentType) => {
    if (!workflow) return;

    const nodes = workflow.actions
      .filter((a) => nodeIds.includes(a.id))
      .map(
        (action) =>
          ({
            id: action.id,
            position: { x: action.position[0], y: action.position[1] },
            data: { action },
          }) as CanvasNode
      );

    const updates = alignNodes(nodes, type);
    moveActions(updates);

    if (onAlign) {
      onAlign(type);
    }
  };

  const handleDistribute = (type: DistributionType) => {
    if (!workflow) return;

    const nodes = workflow.actions
      .filter((a) => nodeIds.includes(a.id))
      .map(
        (action) =>
          ({
            id: action.id,
            position: { x: action.position[0], y: action.position[1] },
            data: { action },
          }) as CanvasNode
      );

    const updates = distributeNodes(nodes, type);
    moveActions(updates);

    if (onDistribute) {
      onDistribute(type);
    }
  };

  if (nodeIds.length < 2) return null;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-2">
      {/* Alignment Tools */}
      <div className="mb-2">
        <div className="text-xs text-gray-400 font-semibold mb-2 px-2">
          Align
        </div>
        <div className="grid grid-cols-3 gap-1">
          <button
            onClick={() => handleAlign("left")}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            title="Align Left (Ctrl+Shift+L)"
          >
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h8M4 18h16"
              />
            </svg>
          </button>
          <button
            onClick={() => handleAlign("center-horizontal")}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            title="Align Center Horizontal"
          >
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <button
            onClick={() => handleAlign("right")}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            title="Align Right (Ctrl+Shift+R)"
          >
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M12 12h8M4 18h16"
              />
            </svg>
          </button>
          <button
            onClick={() => handleAlign("top")}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            title="Align Top (Ctrl+Shift+T)"
          >
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4h16M4 12h8M4 20h16"
              />
            </svg>
          </button>
          <button
            onClick={() => handleAlign("center-vertical")}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            title="Align Center Vertical"
          >
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4h16M4 12h16M4 20h16"
              />
            </svg>
          </button>
          <button
            onClick={() => handleAlign("bottom")}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            title="Align Bottom (Ctrl+Shift+B)"
          >
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4h16M12 12h8M4 20h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Distribution Tools */}
      {nodeIds.length >= 3 && (
        <div>
          <div className="text-xs text-gray-400 font-semibold mb-2 px-2">
            Distribute
          </div>
          <div className="grid grid-cols-3 gap-1">
            <button
              onClick={() => handleDistribute("horizontal")}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              title="Distribute Horizontally (Ctrl+Shift+H)"
            >
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 9h8M8 15h8"
                />
              </svg>
            </button>
            <button
              onClick={() => handleDistribute("vertical")}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              title="Distribute Vertically (Ctrl+Shift+V)"
            >
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 8v8M15 8v8"
                />
              </svg>
            </button>
            <button
              onClick={() => handleDistribute("even")}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              title="Distribute Evenly"
            >
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AlignmentTools;
