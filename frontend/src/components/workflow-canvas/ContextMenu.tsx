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
import { icons } from "./context-menu-icons";
import { useContextMenu } from "./_hooks/use-context-menu";
import type { ContextMenuItem, ContextMenuProps } from "./context-menu-types";

// Re-export types and hook for consumers
export type {
  ContextMenuItem,
  ContextMenuProps,
  ContextMenuType,
  ContextMenuState,
} from "./context-menu-types";
export { useContextMenu } from "./_hooks/use-context-menu";

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

  const handleItemClick = useCallback(
    (item: ContextMenuItem, index: number) => {
      if (item.disabled) return;

      if (item.submenu) {
        setActiveSubmenu(activeSubmenu === index ? null : index);
      } else if (item.onClick) {
        item.onClick();
        onClose();
      }
    },
    [activeSubmenu, onClose]
  );

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[200px] bg-surface-raised border border-border-default rounded-lg shadow-xl overflow-hidden"
      style={{
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
      }}
    >
      <div className="py-1">
        {items.map((item, index) => {
          if (item.divider) {
            return (
              <div
                key={index}
                className="my-1 border-t border-border-default"
              />
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
                      ? "text-text-muted cursor-not-allowed"
                      : item.danger
                        ? "text-red-400 hover:bg-red-900/20"
                        : "text-text-secondary hover:bg-surface-raised"
                  }
                  ${isSelected && !item.disabled ? "bg-surface-raised" : ""}
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
                  <span className="text-xs text-text-muted flex-shrink-0">
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
                <div className="absolute left-full top-0 ml-1 min-w-[200px] bg-surface-raised border border-border-default rounded-lg shadow-xl overflow-hidden">
                  <div className="py-1">
                    {item.submenu!.map((subItem, subIndex) => {
                      if (subItem.divider) {
                        return (
                          <div
                            key={subIndex}
                            className="my-1 border-t border-border-default"
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
                                ? "text-text-muted cursor-not-allowed"
                                : subItem.danger
                                  ? "text-red-400 hover:bg-red-900/20"
                                  : "text-text-secondary hover:bg-surface-raised"
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
                            <span className="text-xs text-text-muted">
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
export { icons as ContextMenuIcons } from "./context-menu-icons";
