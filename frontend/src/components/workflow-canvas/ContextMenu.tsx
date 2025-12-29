/**
 * Context Menu Component - Right-click menu system for canvas interactions
 *
 * Provides context-aware menus for:
 * - Canvas (empty space)
 * - Nodes
 * - Edges
 * - Multi-selection
 *
 * Features:
 * - Nested submenus (max 2 levels)
 * - Keyboard navigation
 * - Icon support
 * - Keyboard shortcut display
 * - Smart positioning (stays in viewport)
 * - Accessibility support
 */

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useCanvasStore } from "@/stores/canvas-store";

// ============================================================================
// Types
// ============================================================================

export interface ContextMenuItem {
  label?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick?: () => void;
  submenu?: ContextMenuItem[];
  disabled?: boolean;
  divider?: boolean;
  danger?: boolean;
}

export interface ContextMenuProps {
  position: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
  parent?: HTMLElement;
}

export type ContextMenuType = "canvas" | "node" | "edge" | "multi-select";

export interface ContextMenuState {
  type: ContextMenuType;
  position: { x: number; y: number };
  items: ContextMenuItem[];
  nodeId?: string;
  edgeId?: string;
  selectedNodeIds?: string[];
}

// ============================================================================
// Icons (Simple SVG icons)
// ============================================================================

const icons = {
  add: (
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
        d="M12 4v16m8-8H4"
      />
    </svg>
  ),
  edit: (
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
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  ),
  copy: (
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
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  ),
  paste: (
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
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
      />
    </svg>
  ),
  cut: (
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
        d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"
      />
    </svg>
  ),
  delete: (
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
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  ),
  duplicate: (
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
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  ),
  disable: (
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
        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
      />
    </svg>
  ),
  select: (
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
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  ),
  fitView: (
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
        d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
      />
    </svg>
  ),
  layout: (
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
        d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z"
      />
    </svg>
  ),
  grid: (
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
        d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z"
      />
    </svg>
  ),
  star: (
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
        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
      />
    </svg>
  ),
  snapshot: (
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
        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  ),
  comment: (
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
        d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
      />
    </svg>
  ),
  align: (
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
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  ),
  distribute: (
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
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
      />
    </svg>
  ),
  group: (
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
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  ),
  connection: (
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
        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
      />
    </svg>
  ),
  chevronRight: (
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
        d="M9 5l7 7-7 7"
      />
    </svg>
  ),
};

// ============================================================================
// Context Menu Component
// ============================================================================

export function ContextMenu({
  position,
  items,
  onClose,
  parent: _parent,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  // Adjust position to keep menu in viewport
  useEffect(() => {
    if (!menuRef.current) return;

    const rect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let { x, y } = position;

    // Adjust horizontal position
    if (x + rect.width > viewportWidth) {
      x = viewportWidth - rect.width - 10;
    }

    // Adjust vertical position
    if (y + rect.height > viewportHeight) {
      y = viewportHeight - rect.height - 10;
    }

    setAdjustedPosition({ x: Math.max(10, x), y: Math.max(10, y) });
  }, [position]);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeItems = items.filter(
        (item) => !item.divider && !item.disabled
      );

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % activeItems.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex(
            (prev) => (prev - 1 + activeItems.length) % activeItems.length
          );
          break;
        case "ArrowRight":
          if (activeItems[selectedIndex]?.submenu) {
            setActiveSubmenu(selectedIndex);
          }
          break;
        case "ArrowLeft":
          setActiveSubmenu(null);
          break;
        case "Enter":
          e.preventDefault();
          const item = activeItems[selectedIndex];
          if (item && !item.submenu && item.onClick) {
            item.onClick();
            onClose();
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [items, selectedIndex, onClose]);

  const handleItemClick = (item: ContextMenuItem, index: number) => {
    if (item.disabled) return;

    if (item.submenu) {
      setActiveSubmenu(activeSubmenu === index ? null : index);
    } else if (item.onClick) {
      item.onClick();
      onClose();
    }
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden"
      style={{
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
      }}
    >
      <div className="py-1">
        {items.map((item, index) => {
          if (item.divider) {
            return (
              <div key={index} className="my-1 border-t border-gray-700" />
            );
          }

          const isSelected = index === selectedIndex;
          const hasSubmenu = !!item.submenu;

          return (
            <div key={index} className="relative">
              <button
                className={`
                  w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-3
                  transition-colors duration-100
                  ${
                    item.disabled
                      ? "text-gray-500 cursor-not-allowed"
                      : item.danger
                        ? "text-red-400 hover:bg-red-900/20"
                        : "text-gray-200 hover:bg-gray-700"
                  }
                  ${isSelected && !item.disabled ? "bg-gray-700" : ""}
                `}
                onClick={() => handleItemClick(item, index)}
                onMouseEnter={() => setSelectedIndex(index)}
                disabled={item.disabled}
              >
                <div className="flex items-center gap-2 flex-1">
                  {item.icon && (
                    <span className="flex-shrink-0">{item.icon}</span>
                  )}
                  <span className="flex-1">{item.label}</span>
                </div>

                {item.shortcut && (
                  <span className="text-xs text-gray-500 flex-shrink-0">
                    {item.shortcut}
                  </span>
                )}

                {hasSubmenu && (
                  <span className="flex-shrink-0 ml-2">
                    {icons.chevronRight}
                  </span>
                )}
              </button>

              {/* Submenu */}
              {hasSubmenu && activeSubmenu === index && (
                <div className="absolute left-full top-0 ml-1 min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                  <div className="py-1">
                    {item.submenu!.map((subItem, subIndex) => {
                      if (subItem.divider) {
                        return (
                          <div
                            key={subIndex}
                            className="my-1 border-t border-gray-700"
                          />
                        );
                      }

                      return (
                        <button
                          key={subIndex}
                          className={`
                            w-full px-3 py-2 text-left text-sm flex items-center gap-2
                            transition-colors duration-100
                            ${
                              subItem.disabled
                                ? "text-gray-500 cursor-not-allowed"
                                : subItem.danger
                                  ? "text-red-400 hover:bg-red-900/20"
                                  : "text-gray-200 hover:bg-gray-700"
                            }
                          `}
                          onClick={() => {
                            if (!subItem.disabled && subItem.onClick) {
                              subItem.onClick();
                              onClose();
                            }
                          }}
                          disabled={subItem.disabled}
                        >
                          {subItem.icon && <span>{subItem.icon}</span>}
                          <span className="flex-1">{subItem.label}</span>
                          {subItem.shortcut && (
                            <span className="text-xs text-gray-500">
                              {subItem.shortcut}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Context Menu Hook - Manages menu state and generation
// ============================================================================

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
      const items: ContextMenuItem[] = [
        {
          label: "Add Node",
          icon: icons.add,
          submenu: [
            {
              label: "Find Actions",
              icon: icons.select,
              submenu: [
                { label: "Find", onClick: () => {} },
                {
                  label: "Find State",
                  onClick: () => {},
                },
                { label: "Vanish", onClick: () => {} },
                { label: "Exists", onClick: () => {} },
                { label: "Wait", onClick: () => {} },
              ],
            },
            {
              label: "Mouse Actions",
              icon: icons.select,
              submenu: [
                { label: "Click", onClick: () => {} },
                {
                  label: "Double Click",
                  onClick: () => {},
                },
                {
                  label: "Right Click",
                  onClick: () => {},
                },
                { label: "Drag", onClick: () => {} },
              ],
            },
            {
              label: "Keyboard Actions",
              icon: icons.select,
              submenu: [
                { label: "Type", onClick: () => {} },
                {
                  label: "Key Press",
                  onClick: () => {},
                },
                { label: "Hotkey", onClick: () => {} },
              ],
            },
            {
              label: "Control Flow",
              icon: icons.select,
              submenu: [
                { label: "If", onClick: () => {} },
                { label: "Loop", onClick: () => {} },
                { label: "Switch", onClick: () => {} },
              ],
            },
          ],
        },
        {
          label: "Paste",
          icon: icons.paste,
          shortcut: "Ctrl+V",
          onClick: () => paste(position),
          disabled: clipboardNodes.length === 0,
        },
        { divider: true },
        {
          label: "Select All",
          icon: icons.select,
          shortcut: "Ctrl+A",
          onClick: selectAll,
        },
        {
          label: "Fit View",
          icon: icons.fitView,
          shortcut: "Ctrl+F",
          onClick: () => {},
        },
        {
          label: "Auto Layout",
          icon: icons.layout,
          shortcut: "Ctrl+L",
          onClick: () => {},
        },
        { divider: true },
        {
          label: "Grid Settings",
          icon: icons.grid,
          submenu: [
            {
              label: "Show Grid",
              onClick: toggleGrid,
            },
            {
              label: "Snap to Grid",
              onClick: toggleSnapToGrid,
            },
            { divider: true },
            {
              label: "Grid Size: 10px",
              onClick: () => {},
            },
            {
              label: "Grid Size: 20px",
              onClick: () => {},
            },
            {
              label: "Grid Size: 25px",
              onClick: () => {},
            },
          ],
        },
      ];

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
      const items: ContextMenuItem[] = [
        {
          label: "Edit Properties",
          icon: icons.edit,
          shortcut: "Enter",
          onClick: () => {},
        },
        { divider: true },
        {
          label: "Duplicate",
          icon: icons.duplicate,
          shortcut: "Ctrl+D",
          onClick: duplicate,
        },
        {
          label: "Copy",
          icon: icons.copy,
          shortcut: "Ctrl+C",
          onClick: copy,
        },
        {
          label: "Cut",
          icon: icons.cut,
          shortcut: "Ctrl+X",
          onClick: cut,
        },
        { divider: true },
        {
          label: "Enable/Disable",
          icon: icons.disable,
          onClick: () => {},
        },
        {
          label: "Add to Favorites",
          icon: icons.star,
          onClick: () => {},
        },
        {
          label: "Create Snapshot",
          icon: icons.snapshot,
          onClick: () => {},
        },
        {
          label: "Add Comment",
          icon: icons.comment,
          onClick: () => {},
        },
        { divider: true },
        {
          label: "Delete",
          icon: icons.delete,
          shortcut: "Del",
          onClick: () => deleteActions([nodeId]),
          danger: true,
        },
      ];

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
      const items: ContextMenuItem[] = [
        {
          label: "Edit Connection",
          icon: icons.edit,
          onClick: () => {},
        },
        {
          label: "Add Intermediate Node",
          icon: icons.add,
          onClick: () => {},
        },
        {
          label: "Change Connection Type",
          icon: icons.connection,
          submenu: [
            { label: "Main Flow", onClick: () => {} },
            {
              label: "Error Handling",
              onClick: () => {},
            },
            {
              label: "Success Condition",
              onClick: () => {},
            },
            {
              label: "Parallel Execution",
              onClick: () => {},
            },
          ],
        },
        { divider: true },
        {
          label: "Delete Connection",
          icon: icons.delete,
          shortcut: "Del",
          onClick: () => {},
          danger: true,
        },
      ];

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
      const items: ContextMenuItem[] = [
        {
          label: "Align",
          icon: icons.align,
          submenu: [
            { label: "Align Left", onClick: () => {} },
            { label: "Align Right", onClick: () => {} },
            { label: "Align Top", onClick: () => {} },
            {
              label: "Align Bottom",
              onClick: () => {},
            },
            {
              label: "Align Center Horizontal",
              onClick: () => {},
            },
            {
              label: "Align Center Vertical",
              onClick: () => {},
            },
          ],
        },
        {
          label: "Distribute",
          icon: icons.distribute,
          submenu: [
            {
              label: "Distribute Horizontally",
              onClick: () => {},
            },
            {
              label: "Distribute Vertically",
              onClick: () => {},
            },
            {
              label: "Distribute Evenly",
              onClick: () => {},
            },
          ],
        },
        {
          label: "Group",
          icon: icons.group,
          onClick: () => {},
        },
        { divider: true },
        {
          label: "Copy All",
          icon: icons.copy,
          shortcut: "Ctrl+C",
          onClick: copy,
        },
        {
          label: "Duplicate All",
          icon: icons.duplicate,
          shortcut: "Ctrl+D",
          onClick: duplicate,
        },
        { divider: true },
        {
          label: `Delete All (${nodeIds.length})`,
          icon: icons.delete,
          shortcut: "Del",
          onClick: () => deleteActions(nodeIds),
          danger: true,
        },
      ];

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

// ============================================================================
// Context Menu Container - Renders active menu
// ============================================================================

export function ContextMenuContainer() {
  const { menuState, closeMenu } = useContextMenu();

  if (!menuState) return null;

  return (
    <ContextMenu
      position={menuState.position}
      items={menuState.items}
      onClose={closeMenu}
    />
  );
}

export default ContextMenu;
export { icons as ContextMenuIcons };
