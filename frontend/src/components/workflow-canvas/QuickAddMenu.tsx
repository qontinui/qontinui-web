/**
 * Quick Add Menu Component
 *
 * Context menu for quickly adding nodes at a specific position.
 * Appears on right-click on canvas with search and recent nodes.
 */

import React, { useState, useEffect, useRef } from "react";
import { ActionType } from "@/lib/action-schema/action-types";
import { searchNodes, NODE_METADATA } from "./palette-config";
import { useRecentNodeTypes } from "@/stores/recent-nodes";
import { Search, Clock, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface QuickAddMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onSelect: (nodeType: ActionType) => void;
  onClose: () => void;
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export const QuickAddMenu: React.FC<QuickAddMenuProps> = ({
  isOpen,
  position,
  onSelect,
  onClose,
  className,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [results, setResults] = useState(() =>
    Object.values(NODE_METADATA).slice(0, 8)
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const recentTypes = useRecentNodeTypes(5);

  const recentNodes = recentTypes.map((type) => NODE_METADATA[type]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Search when query changes
  useEffect(() => {
    if (query.trim()) {
      const searchResults = searchNodes(query).slice(0, 8);
      setResults(searchResults);
      setSelectedIndex(0);
    } else {
      // Show recent nodes when no query
      setResults(
        recentNodes.length > 0
          ? recentNodes
          : Object.values(NODE_METADATA).slice(0, 8)
      );
      setSelectedIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, recentTypes]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;

        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;

        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex].type);
          }
          break;

        case "Escape":
          e.preventDefault();
          onClose();
          break;

        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
          } else {
            setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, results, selectedIndex, onClose]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  const handleSelect = (nodeType: ActionType) => {
    onSelect(nodeType);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className={cn("quick-add-menu", className)}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: 9999,
      }}
    >
      {/* Search Input */}
      <div className="quick-add-menu__search">
        <Search className="quick-add-menu__search-icon h-4 w-4 text-text-muted" />
        <input
          ref={inputRef}
          type="text"
          className="quick-add-menu__input"
          placeholder="Search nodes..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!query && (
          <div className="quick-add-menu__hint">
            <kbd className="quick-add-menu__kbd">↓</kbd>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="quick-add-menu__results">
        {/* Header */}
        {!query && recentTypes.length > 0 && (
          <div className="quick-add-menu__section-header">
            <Clock className="h-3 w-3 text-text-muted" />
            <span className="text-xs text-text-muted">Recent</span>
          </div>
        )}

        {results.length > 0 ? (
          <div className="quick-add-menu__list">
            {results.map((metadata, index) => {
              const IconComponent = metadata.icon;

              return (
                <button
                  key={metadata.type}
                  className={cn(
                    "quick-add-menu__item",
                    selectedIndex === index && "quick-add-menu__item--selected"
                  )}
                  onClick={() => handleSelect(metadata.type)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div
                    className="quick-add-menu__item-icon"
                    style={{
                      backgroundColor: `${metadata.category}20`,
                    }}
                  >
                    <IconComponent className="h-4 w-4" />
                  </div>
                  <div className="quick-add-menu__item-content">
                    <span className="quick-add-menu__item-name">
                      {metadata.displayName}
                    </span>
                    <span className="quick-add-menu__item-description">
                      {metadata.description}
                    </span>
                  </div>
                  {metadata.multiOutput && (
                    <span className="quick-add-menu__badge">Multi</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="quick-add-menu__empty">
            <Search className="h-8 w-8 text-text-secondary" />
            <p className="text-sm text-text-muted">No nodes found</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="quick-add-menu__footer">
        <div className="quick-add-menu__shortcuts">
          <span className="quick-add-menu__shortcut">
            <kbd>↑↓</kbd> Navigate
          </span>
          <span className="quick-add-menu__shortcut">
            <kbd>Enter</kbd> Select
          </span>
          <span className="quick-add-menu__shortcut">
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Hook for Quick Add Menu
// ============================================================================

interface QuickAddMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
}

export function useQuickAddMenu() {
  const [state, setState] = useState<QuickAddMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
  });

  const open = (x: number, y: number) => {
    setState({ isOpen: true, position: { x, y } });
  };

  const close = () => {
    setState((prev) => ({ ...prev, isOpen: false }));
  };

  return {
    isOpen: state.isOpen,
    position: state.position,
    open,
    close,
  };
}

// ============================================================================
// Canvas Context Menu Integration
// ============================================================================

interface CanvasContextMenuProps {
  children: React.ReactNode;
  onAddNode: (nodeType: ActionType, position: { x: number; y: number }) => void;
  disabled?: boolean;
}

export const CanvasContextMenu: React.FC<CanvasContextMenuProps> = ({
  children,
  onAddNode,
  disabled = false,
}) => {
  const { isOpen, position, open, close } = useQuickAddMenu();
  const [clickPosition, setClickPosition] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  const handleContextMenu = (e: React.MouseEvent) => {
    if (disabled) return;

    e.preventDefault();

    // Store the canvas position where user clicked
    setClickPosition({ x: e.clientX, y: e.clientY });

    // Open menu at cursor position
    open(e.clientX, e.clientY);
  };

  const handleSelect = (nodeType: ActionType) => {
    onAddNode(nodeType, clickPosition);
    close();
  };

  return (
    <div onContextMenu={handleContextMenu}>
      {children}
      <QuickAddMenu
        isOpen={isOpen}
        position={position}
        onSelect={handleSelect}
        onClose={close}
      />
    </div>
  );
};

// ============================================================================
// Quick Actions Panel (Alternative UI)
// ============================================================================

interface QuickActionsPanelProps {
  onSelect: (nodeType: ActionType) => void;
  maxItems?: number;
  className?: string;
}

export const QuickActionsPanel: React.FC<QuickActionsPanelProps> = ({
  onSelect,
  maxItems = 6,
  className,
}) => {
  const recentTypes = useRecentNodeTypes(maxItems);
  const recentNodes = recentTypes.map((type) => NODE_METADATA[type]);

  // Fallback to common nodes if no recent
  const quickNodes =
    recentNodes.length > 0
      ? recentNodes
      : [
          NODE_METADATA.FIND,
          NODE_METADATA.CLICK,
          NODE_METADATA.TYPE,
          NODE_METADATA.IF,
          NODE_METADATA.VANISH,
          NODE_METADATA.LOOP,
        ].slice(0, maxItems);

  return (
    <div className={cn("quick-actions-panel", className)}>
      <div className="quick-actions-panel__header">
        <Zap className="h-4 w-4 text-yellow-500" />
        <span className="text-sm font-medium text-text-secondary">
          Quick Add
        </span>
      </div>
      <div className="quick-actions-panel__grid">
        {quickNodes.map((metadata) => {
          const IconComponent = metadata.icon;
          return (
            <button
              key={metadata.type}
              className="quick-actions-panel__button"
              onClick={() => onSelect(metadata.type)}
              title={metadata.description}
            >
              <IconComponent className="h-5 w-5" />
              <span className="text-xs">{metadata.displayName}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default QuickAddMenu;
