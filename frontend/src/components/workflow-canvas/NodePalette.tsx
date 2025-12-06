/**
 * Node Palette Component
 *
 * Main palette UI for browsing and adding nodes to the canvas.
 * Features categories, search, favorites, recent nodes, drag-and-drop.
 */

import React, { useState, useMemo } from "react";
import { ActionType } from "@/lib/action-schema/action-types";
import {
  getCategoriesOrdered,
  getNodesByCategory,
  NODE_METADATA,
  NodeCategory,
} from "./palette-config";
import { PaletteItem } from "./PaletteItem";
import { NodeSearch } from "./NodeSearch";
import { usePaletteDrag, useClickToAdd } from "./palette-drag";
import { useFavoriteNodeTypes } from "@/stores/favorite-nodes";
import { useRecentNodeTypes } from "@/stores/recent-nodes";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Star,
  Clock,
  Minimize2,
  Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import "./NodePalette.css";

// ============================================================================
// Types
// ============================================================================

export interface NodePaletteProps {
  position?: "left" | "right" | "floating";
  collapsible?: boolean;
  showSearch?: boolean;
  showRecent?: boolean;
  showFavorites?: boolean;
  defaultCollapsed?: boolean;
  onNodeAdd?: (nodeType: ActionType) => void;
  canvasRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}

interface CategoryState {
  [key: string]: boolean; // expanded state
}

// ============================================================================
// Component
// ============================================================================

export const NodePalette: React.FC<NodePaletteProps> = ({
  position = "left",
  collapsible = true,
  showSearch = true,
  showRecent = true,
  showFavorites = true,
  defaultCollapsed = false,
  onNodeAdd,
  canvasRef,
  className,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [categoryStates, setCategoryStates] = useState<CategoryState>({
    find: true,
    mouse: true,
    keyboard: false,
    controlFlow: true,
    data: false,
    state: false,
    code: false,
  });

  const categories = useMemo(() => getCategoriesOrdered(), []);
  const favoriteTypes = useFavoriteNodeTypes();
  const recentTypes = useRecentNodeTypes(5);

  const { addNodeAtCenter } = useClickToAdd();
  const dragHandlers = usePaletteDrag(canvasRef as React.RefObject<HTMLElement>);

  // Get favorite and recent metadata
  const favoriteNodes = useMemo(
    () => favoriteTypes.map((type) => NODE_METADATA[type]),
    [favoriteTypes]
  );

  const recentNodes = useMemo(
    () => recentTypes.map((type) => NODE_METADATA[type]),
    [recentTypes]
  );

  const toggleCategory = (categoryId: NodeCategory) => {
    setCategoryStates((prev) => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));
  };

  const toggleAllCategories = (expanded: boolean) => {
    const newState: CategoryState = {};
    categories.forEach((cat) => {
      newState[cat.id] = expanded;
    });
    setCategoryStates(newState);
  };

  const handleNodeAdd = (nodeType: ActionType) => {
    console.log("[NodePalette] handleNodeAdd called with:", nodeType);
    console.log("[NodePalette] onNodeAdd callback exists:", !!onNodeAdd);

    // If onNodeAdd is provided, use it (parent handles the addition)
    // Otherwise use addNodeAtCenter (adds to canvas store)
    if (onNodeAdd) {
      console.log("[NodePalette] Using parent onNodeAdd callback");
      onNodeAdd(nodeType);
    } else {
      console.log("[NodePalette] Using addNodeAtCenter");
      addNodeAtCenter(nodeType);
    }
  };

  const handleDragStart = (nodeType: ActionType, event: React.DragEvent) => {
    dragHandlers.onDragStart(nodeType, event);
  };

  // Compact mode when collapsed
  if (isCollapsed) {
    return (
      <div
        className={cn(
          "node-palette",
          "node-palette--collapsed",
          `node-palette--${position}`,
          className
        )}
      >
        <button
          className="node-palette__expand-btn"
          onClick={() => setIsCollapsed(false)}
          title="Expand palette"
        >
          <Maximize2 className="h-5 w-5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "node-palette",
        `node-palette--${position}`,
        dragHandlers.isDragging && "node-palette--dragging",
        className
      )}
    >
      {/* Header */}
      <div className="node-palette__header">
        <div className="flex items-start justify-between gap-4 flex-1">
          {/* Left: Title */}
          <h3 className="node-palette__title">Nodes</h3>

          {/* Right: Tips */}
          <div className="flex flex-col items-start text-xs text-gray-500 leading-relaxed">
            <span>Drag to add</span>
            <span>Click for center</span>
            <span>Ctrl+K to search</span>
          </div>
        </div>
        <div className="node-palette__header-actions">
          {showSearch && (
            <button
              className={cn(
                "node-palette__header-btn",
                showSearchPanel && "node-palette__header-btn--active"
              )}
              onClick={() => setShowSearchPanel(!showSearchPanel)}
              title="Search nodes (Ctrl+K)"
            >
              <Search className="h-4 w-4" />
            </button>
          )}
          {collapsible && (
            <button
              className="node-palette__header-btn"
              onClick={() => setIsCollapsed(true)}
              title="Collapse palette"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Search Panel */}
      {showSearchPanel && (
        <div className="node-palette__search-panel">
          <NodeSearch
            onSelect={(nodeType) => {
              handleNodeAdd(nodeType);
              setShowSearchPanel(false);
            }}
            onClose={() => setShowSearchPanel(false)}
            maxResults={10}
          />
        </div>
      )}

      {/* Content */}
      <div className="node-palette__content">
        {/* Favorites Section */}
        {showFavorites && favoriteNodes.length > 0 && (
          <div className="node-palette__section">
            <button
              className="node-palette__section-header"
              onClick={() => toggleCategory("favorites" as NodeCategory)}
            >
              <Star className="h-4 w-4 text-yellow-500" />
              <span className="node-palette__section-title">Favorites</span>
              <span className="node-palette__section-count">
                {favoriteNodes.length}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  !categoryStates.favorites && "-rotate-90"
                )}
              />
            </button>
            {categoryStates.favorites !== false && (
              <div className="node-palette__section-content">
                {favoriteNodes.map((metadata) => (
                  <PaletteItem
                    key={metadata.type}
                    metadata={metadata}
                    onDragStart={handleDragStart}
                    onAdd={handleNodeAdd}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recent Section */}
        {showRecent && recentNodes.length > 0 && (
          <div className="node-palette__section">
            <button
              className="node-palette__section-header"
              onClick={() => toggleCategory("recent" as NodeCategory)}
            >
              <Clock className="h-4 w-4 text-blue-500" />
              <span className="node-palette__section-title">Recent</span>
              <span className="node-palette__section-count">
                {recentNodes.length}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  !categoryStates.recent && "-rotate-90"
                )}
              />
            </button>
            {categoryStates.recent !== false && (
              <div className="node-palette__section-content">
                {recentNodes.map((metadata) => (
                  <PaletteItem
                    key={metadata.type}
                    metadata={metadata}
                    onDragStart={handleDragStart}
                    onAdd={handleNodeAdd}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Divider */}
        {((showFavorites && favoriteNodes.length > 0) ||
          (showRecent && recentNodes.length > 0)) && (
          <div className="node-palette__divider" />
        )}

        {/* Category Sections */}
        <div className="node-palette__categories">
          {/* Expand/Collapse All */}
          <div className="node-palette__category-controls">
            <button
              className="node-palette__control-btn"
              onClick={() => toggleAllCategories(true)}
            >
              Expand All
            </button>
            <button
              className="node-palette__control-btn"
              onClick={() => toggleAllCategories(false)}
            >
              Collapse All
            </button>
          </div>

          {categories.map((category) => {
            const nodes = getNodesByCategory(category.id);
            const isExpanded = categoryStates[category.id] !== false;
            const CategoryIcon = category.icon;

            return (
              <div key={category.id} className="node-palette__category">
                <button
                  className="node-palette__category-header"
                  onClick={() => toggleCategory(category.id)}
                  style={{ borderLeftColor: category.color }}
                >
                  <div className="node-palette__category-icon-wrapper">
                    <CategoryIcon
                      className="h-4 w-4"
                      style={{ color: category.color }}
                    />
                  </div>
                  <div className="node-palette__category-info">
                    <span className="node-palette__category-title">
                      {category.label}
                    </span>
                    <span className="node-palette__category-description">
                      {category.description}
                    </span>
                  </div>
                  <div className="node-palette__category-meta">
                    <span className="node-palette__category-count">
                      {nodes.length}
                    </span>
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="node-palette__category-content">
                    {nodes.map((metadata) => (
                      <PaletteItem
                        key={metadata.type}
                        metadata={metadata}
                        onDragStart={handleDragStart}
                        onAdd={handleNodeAdd}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer - Available for future actions */}
      {/* You can add action buttons or other controls here */}
    </div>
  );
};

// ============================================================================
// Floating Palette Variant
// ============================================================================

interface FloatingPaletteProps extends Omit<NodePaletteProps, "position"> {
  defaultPosition?: { x: number; y: number };
  onPositionChange?: (position: { x: number; y: number }) => void;
}

export const FloatingPalette: React.FC<FloatingPaletteProps> = ({
  defaultPosition = { x: 20, y: 20 },
  onPositionChange,
  ...props
}) => {
  const [position, setPosition] = useState(defaultPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".node-palette__header")) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      const newPosition = {
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      };
      setPosition(newPosition);
      if (onPositionChange) {
        onPositionChange(newPosition);
      }
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
    return undefined;
  }, [isDragging, dragStart]);

  return (
    <div
      className={cn(
        "node-palette--floating",
        isDragging && "node-palette--dragging-window"
      )}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: 1000,
      }}
      onMouseDown={handleMouseDown}
    >
      <NodePalette {...props} position="floating" />
    </div>
  );
};

// ============================================================================
// Compact Palette Variant
// ============================================================================

export const CompactPalette: React.FC<NodePaletteProps> = (props) => {
  return (
    <div className="node-palette--compact">
      <NodePalette {...props} showRecent={false} showFavorites={false} />
    </div>
  );
};

export default NodePalette;
