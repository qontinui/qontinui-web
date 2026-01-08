/**
 * Mini Toolbar - Quick action toolbar for selected nodes
 *
 * Features:
 * - Appears above selected node(s)
 * - Quick actions: Copy, Delete, Duplicate, Disable
 * - Follows selection on drag
 * - Fades when not hovering
 * - Shows keyboard shortcuts
 */

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { ContextMenuIcons } from "./ContextMenu";

// ============================================================================
// Types
// ============================================================================

export interface MiniToolbarProps {
  nodeIds: string[];
  position: { x: number; y: number };
  onClose?: () => void;
}

export interface ToolbarAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

// ============================================================================
// Mini Toolbar Component
// ============================================================================

export function MiniToolbar({ nodeIds, position, onClose }: MiniToolbarProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const { copy, duplicate, deleteActions } = useCanvasStore();

  // Actions
  const actions: ToolbarAction[] = [
    {
      id: "copy",
      label: "Copy",
      icon: ContextMenuIcons.copy,
      shortcut: "Ctrl+C",
      onClick: copy,
    },
    {
      id: "duplicate",
      label: "Duplicate",
      icon: ContextMenuIcons.duplicate,
      shortcut: "Ctrl+D",
      onClick: duplicate,
    },
    {
      id: "disable",
      label: "Disable",
      icon: ContextMenuIcons.disable,
      onClick: () => {
        nodeIds.forEach((id) => {
          // Toggle disable state
          // Note: This would require updating the action in the store
          console.log("Toggle disable", id);
        });
      },
    },
    {
      id: "delete",
      label: "Delete",
      icon: ContextMenuIcons.delete,
      shortcut: "Del",
      onClick: () => deleteActions(nodeIds),
      danger: true,
    },
  ];

  // Fade toolbar when not hovering
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    if (!isHovering) {
      timeoutId = setTimeout(() => {
        setOpacity(0.6);
      }, 1000);
    } else {
      setOpacity(1);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isHovering]);

  return (
    <div
      ref={toolbarRef}
      className="fixed z-[9000] pointer-events-auto"
      style={{
        left: `${position.x}px`,
        top: `${position.y - 60}px`,
        opacity,
        transition: "opacity 200ms ease-in-out",
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div className="flex items-center gap-1 bg-surface-raised border border-border-default rounded-lg shadow-xl p-1">
        {/* Node count badge */}
        <div className="px-2 py-1 text-xs text-text-muted border-r border-border-default">
          {nodeIds.length} {nodeIds.length === 1 ? "node" : "nodes"}
        </div>

        {/* Actions */}
        {actions.map((action) => (
          <button
            key={action.id}
            onClick={action.onClick}
            disabled={action.disabled}
            className={`
              group relative px-3 py-2 rounded transition-all duration-150
              ${
                action.disabled
                  ? "text-text-muted cursor-not-allowed"
                  : action.danger
                    ? "text-red-400 hover:bg-red-900/20"
                    : "text-text-secondary hover:bg-surface-raised/80"
              }
            `}
            title={action.label}
          >
            {action.icon}

            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-surface-canvas text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              {action.label}
              {action.shortcut && (
                <span className="ml-2 text-text-muted">{action.shortcut}</span>
              )}
            </div>
          </button>
        ))}

        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="px-2 py-2 text-text-muted hover:text-white hover:bg-surface-raised/80 rounded transition-colors ml-1 border-l border-border-default"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Mini Toolbar Manager Hook
// ============================================================================

export function useMiniToolbar() {
  const [toolbarState, setToolbarState] = useState<{
    nodeIds: string[];
    position: { x: number; y: number };
  } | null>(null);

  const showToolbar = useCallback(
    (nodeIds: string[], position: { x: number; y: number }) => {
      setToolbarState({ nodeIds, position });
    },
    []
  );

  const hideToolbar = useCallback(() => {
    setToolbarState(null);
  }, []);

  const updatePosition = useCallback((position: { x: number; y: number }) => {
    setToolbarState((prev) => (prev ? { ...prev, position } : null));
  }, []);

  return {
    toolbarState,
    showToolbar,
    hideToolbar,
    updatePosition,
  };
}

// ============================================================================
// Mini Toolbar Container - Automatically shows/hides based on selection
// ============================================================================

export function MiniToolbarContainer() {
  const { selectedNodes } = useCanvasStore();
  const { toolbarState, showToolbar, hideToolbar } = useMiniToolbar();

  useEffect(() => {
    if (selectedNodes.length > 0) {
      // Calculate center position of selected nodes
      // This would require getting node positions from React Flow
      // For now, use a default position
      showToolbar(selectedNodes, { x: 400, y: 300 });
    } else {
      hideToolbar();
    }
  }, [selectedNodes, showToolbar, hideToolbar]);

  if (!toolbarState) return null;

  return (
    <MiniToolbar
      nodeIds={toolbarState.nodeIds}
      position={toolbarState.position}
      onClose={hideToolbar}
    />
  );
}

export default MiniToolbar;
