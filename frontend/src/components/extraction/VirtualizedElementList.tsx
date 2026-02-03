/**
 * Virtualized Element List Component
 *
 * A performant element list that uses virtualization to handle large numbers
 * of annotations efficiently. Only renders visible items in the viewport.
 *
 * Features:
 * - Manual virtualization (no external dependencies)
 * - Fixed height items for consistent scrolling
 * - Click to select, Shift+click for multi-select
 * - Keyboard navigation support
 * - Visual indicators for element type, review status, and ground truth
 */

"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  memo,
} from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
  CheckCheck,
  XCircle,
  AlertCircle,
  Sparkles,
  MousePointer,
} from "lucide-react";
import {
  useExtractionAnnotationStore,
  type AnnotatedElement,
  type ReviewStatus,
} from "@/stores/extraction-annotation-store";
import { cn } from "@/lib/utils";

// Virtualization constants
const ITEM_HEIGHT = 48;
const OVERSCAN = 5;

// Review status configuration
const REVIEW_STATUS_CONFIG: Record<
  ReviewStatus,
  { label: string; icon: React.ReactNode; bgColor: string; textColor: string }
> = {
  pending: {
    label: "Pending",
    icon: <Clock className="h-3 w-3" />,
    bgColor: "bg-yellow-500/10",
    textColor: "text-yellow-500",
  },
  approved: {
    label: "Approved",
    icon: <CheckCheck className="h-3 w-3" />,
    bgColor: "bg-green-500/10",
    textColor: "text-green-500",
  },
  rejected: {
    label: "Rejected",
    icon: <XCircle className="h-3 w-3" />,
    bgColor: "bg-red-500/10",
    textColor: "text-red-500",
  },
  needs_revision: {
    label: "Needs Revision",
    icon: <AlertCircle className="h-3 w-3" />,
    bgColor: "bg-purple-500/10",
    textColor: "text-purple-500",
  },
};

// Element type icons mapping
const ELEMENT_TYPE_LABELS: Record<string, string> = {
  button: "Button",
  input: "Input",
  link: "Link",
  icon: "Icon",
  label: "Text",
  container: "Container",
  checkbox: "Checkbox",
  radio: "Radio",
  dropdown: "Dropdown",
  menu: "Menu",
  tab: "Tab",
  image: "Image",
  other: "Other",
};

interface ElementRowProps {
  element: AnnotatedElement;
  isSelected: boolean;
  isHovered: boolean;
  style: React.CSSProperties;
  onSelect: (id: string, shiftKey: boolean) => void;
  onHover: (id: string | null) => void;
}

/**
 * Memoized element row component for optimal performance.
 * Re-renders only when its props change.
 */
const ElementRow = memo(function ElementRow({
  element,
  isSelected,
  isHovered,
  style,
  onSelect,
  onHover,
}: ElementRowProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      onSelect(element.id, e.shiftKey);
    },
    [element.id, onSelect]
  );

  const handleMouseEnter = useCallback(() => {
    onHover(element.id);
  }, [element.id, onHover]);

  const handleMouseLeave = useCallback(() => {
    onHover(null);
  }, [onHover]);

  const reviewConfig = element.reviewStatus
    ? REVIEW_STATUS_CONFIG[element.reviewStatus]
    : REVIEW_STATUS_CONFIG.pending;

  return (
    <div
      style={style}
      className={cn(
        "absolute left-0 right-0 flex items-center gap-2 px-3 cursor-pointer border-b border-border-subtle transition-colors",
        isSelected
          ? "bg-[#9B59B6]/20 border-l-2 border-l-[#9B59B6]"
          : "hover:bg-surface-raised/50",
        isHovered && !isSelected && "bg-surface-raised/30"
      )}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
    >
      {/* Selection indicator */}
      <div className="flex-shrink-0">
        {isSelected ? (
          <CheckCircle2 className="h-4 w-4 text-[#9B59B6]" />
        ) : (
          <Circle className="h-4 w-4 text-text-muted/30" />
        )}
      </div>

      {/* Element info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-sm font-medium truncate",
              isSelected ? "text-[#9B59B6]" : "text-text-default"
            )}
          >
            {element.label || "Unlabeled"}
          </span>

          {/* Auto-detected badge */}
          {element.isAutoDetected && (
            <Sparkles className="h-3 w-3 text-amber-400 flex-shrink-0" />
          )}

          {/* Ground truth indicator */}
          {element.isGroundTruth && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-green-500/20 text-green-500 flex-shrink-0">
              GT
            </span>
          )}

          {/* Clickable indicator */}
          {element.isClickable && (
            <MousePointer className="h-3 w-3 text-text-muted/50 flex-shrink-0" />
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span>
            {ELEMENT_TYPE_LABELS[element.elementType] || element.elementType}
          </span>
          <span className="opacity-50">|</span>
          <span className="font-mono text-[10px]">
            {element.bbox.width}x{element.bbox.height}
          </span>
        </div>
      </div>

      {/* Review status indicator */}
      <div
        className={cn(
          "flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs",
          reviewConfig.bgColor,
          reviewConfig.textColor
        )}
        title={reviewConfig.label}
      >
        {reviewConfig.icon}
      </div>
    </div>
  );
});

interface VirtualizedElementListProps {
  className?: string;
  /** Filter function to show only certain elements */
  filter?: (element: AnnotatedElement) => boolean;
  /** Optional header content */
  header?: React.ReactNode;
  /** Maximum height of the list */
  maxHeight?: number;
}

/**
 * VirtualizedElementList - Efficiently renders large lists of annotated elements.
 *
 * Uses manual virtualization to only render items visible in the viewport,
 * plus an overscan buffer for smooth scrolling.
 */
export function VirtualizedElementList({
  className,
  filter,
  header,
  maxHeight = 400,
}: VirtualizedElementListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(maxHeight);

  // Store state
  const elements = useExtractionAnnotationStore((state) => state.elements);
  const selectedElementIds = useExtractionAnnotationStore(
    (state) => state.selectedElementIds
  );
  const hoveredElementId = useExtractionAnnotationStore(
    (state) => state.hoveredElementId
  );
  const selectElement = useExtractionAnnotationStore(
    (state) => state.selectElement
  );
  const setHoveredElement = useExtractionAnnotationStore(
    (state) => state.setHoveredElement
  );

  // Apply filter if provided
  const filteredElements = useMemo(() => {
    return filter ? elements.filter(filter) : elements;
  }, [elements, filter]);

  // Calculate virtualization parameters
  const totalHeight = filteredElements.length * ITEM_HEIGHT;
  const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT);
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN
  );
  const endIndex = Math.min(
    filteredElements.length,
    startIndex + visibleCount + OVERSCAN * 2
  );

  // Get visible elements slice
  const visibleElements = useMemo(() => {
    return filteredElements.slice(startIndex, endIndex);
  }, [filteredElements, startIndex, endIndex]);

  // Create a set of selected IDs for O(1) lookup
  const selectedIdSet = useMemo(
    () => new Set(selectedElementIds),
    [selectedElementIds]
  );

  // Handle scroll events
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex =
        selectedElementIds.length > 0
          ? filteredElements.findIndex(
              (el) =>
                el.id === selectedElementIds[selectedElementIds.length - 1]
            )
          : -1;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const nextIndex = Math.min(
            currentIndex + 1,
            filteredElements.length - 1
          );
          const nextElement = filteredElements[nextIndex];
          if (nextElement) {
            selectElement(nextElement.id, e.shiftKey);
            // Scroll into view if needed
            const container = containerRef.current;
            if (container) {
              const itemTop = nextIndex * ITEM_HEIGHT;
              const itemBottom = itemTop + ITEM_HEIGHT;
              if (itemBottom > scrollTop + containerHeight) {
                container.scrollTop = itemBottom - containerHeight;
              }
            }
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prevIndex = Math.max(currentIndex - 1, 0);
          const prevElement = filteredElements[prevIndex];
          if (prevElement) {
            selectElement(prevElement.id, e.shiftKey);
            // Scroll into view if needed
            const container = containerRef.current;
            if (container) {
              const itemTop = prevIndex * ITEM_HEIGHT;
              if (itemTop < scrollTop) {
                container.scrollTop = itemTop;
              }
            }
          }
          break;
        }
        case "Home": {
          e.preventDefault();
          const firstElement = filteredElements[0];
          if (firstElement) {
            selectElement(firstElement.id, false);
            containerRef.current?.scrollTo({ top: 0 });
          }
          break;
        }
        case "End": {
          e.preventDefault();
          const lastElement = filteredElements[filteredElements.length - 1];
          if (lastElement) {
            selectElement(lastElement.id, false);
            containerRef.current?.scrollTo({
              top: totalHeight - containerHeight,
            });
          }
          break;
        }
      }
    },
    [
      selectedElementIds,
      filteredElements,
      selectElement,
      scrollTop,
      containerHeight,
      totalHeight,
    ]
  );

  // Memoized callbacks for child components
  const handleSelect = useCallback(
    (id: string, shiftKey: boolean) => {
      selectElement(id, shiftKey);
    },
    [selectElement]
  );

  const handleHover = useCallback(
    (id: string | null) => {
      setHoveredElement(id);
    },
    [setHoveredElement]
  );

  if (filteredElements.length === 0) {
    return (
      <div className={cn("bg-surface-raised/60 rounded-lg", className)}>
        {header}
        <div className="flex flex-col items-center justify-center py-8 text-center text-text-muted">
          <Circle className="h-8 w-8 mb-2 opacity-30" />
          <p className="text-sm">No elements to display</p>
          <p className="text-xs mt-1 opacity-60">
            Draw elements on the canvas or run extraction
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("bg-surface-raised/60 rounded-lg", className)}>
      {header}

      {/* Element count */}
      <div className="px-3 py-2 border-b border-border-subtle text-xs text-text-muted flex items-center justify-between">
        <span>
          {filteredElements.length} element
          {filteredElements.length !== 1 ? "s" : ""}
        </span>
        {selectedElementIds.length > 0 && (
          <span className="text-[#9B59B6]">
            {selectedElementIds.length} selected
          </span>
        )}
      </div>

      {/* Virtualized list container */}
      <div
        ref={containerRef}
        className="overflow-auto focus:outline-none focus:ring-2 focus:ring-[#9B59B6]/50 focus:ring-inset"
        style={{ maxHeight: `${maxHeight}px` }}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="listbox"
        aria-label="Element list"
        aria-multiselectable="true"
      >
        {/* Spacer for total scroll height */}
        <div style={{ height: totalHeight, position: "relative" }}>
          {visibleElements.map((element, index) => {
            const actualIndex = startIndex + index;
            return (
              <ElementRow
                key={element.id}
                element={element}
                isSelected={selectedIdSet.has(element.id)}
                isHovered={hoveredElementId === element.id}
                style={{
                  top: actualIndex * ITEM_HEIGHT,
                  height: ITEM_HEIGHT,
                }}
                onSelect={handleSelect}
                onHover={handleHover}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
