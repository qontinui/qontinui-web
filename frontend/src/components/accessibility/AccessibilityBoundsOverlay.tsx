"use client";

import * as React from "react";
import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import type {
  AccessibilityNode,
  AccessibilitySnapshot,
} from "@qontinui/shared-types/accessibility";

interface AccessibilityBoundsOverlayProps {
  /** The accessibility snapshot containing nodes with bounds */
  snapshot: AccessibilitySnapshot | null;
  /** Screenshot image URL to overlay bounds on */
  screenshotUrl?: string | null;
  /** Currently selected ref */
  selectedRef?: string | null;
  /** Hovered ref (for external highlight control) */
  hoveredRef?: string | null;
  /** Callback when a node is clicked */
  onSelectNode?: (node: AccessibilityNode) => void;
  /** Callback when a node is hovered */
  onHoverNode?: (node: AccessibilityNode | null) => void;
  /** Only show interactive elements */
  interactiveOnly?: boolean;
  /** Show ref labels on each box */
  showLabels?: boolean;
  /** Overlay opacity (0-1) */
  overlayOpacity?: number;
  /** Additional class names */
  className?: string;
}

interface BoundsNode {
  node: AccessibilityNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Color palette for different element roles
 */
function getRoleColor(role: string): string {
  // Interactive elements
  if (["button", "link", "menuitem", "tab"].includes(role)) {
    return "rgba(139, 92, 246, 0.5)"; // Purple
  }
  // Form inputs
  if (
    [
      "textbox",
      "searchbox",
      "combobox",
      "checkbox",
      "radio",
      "slider",
      "spinbutton",
    ].includes(role)
  ) {
    return "rgba(59, 130, 246, 0.5)"; // Blue
  }
  // Containers
  if (["dialog", "menu", "listbox", "grid", "tree", "tablist"].includes(role)) {
    return "rgba(34, 197, 94, 0.5)"; // Green
  }
  // Navigation
  if (
    ["navigation", "banner", "main", "complementary", "contentinfo"].includes(
      role
    )
  ) {
    return "rgba(245, 158, 11, 0.5)"; // Amber
  }
  // Default
  return "rgba(107, 114, 128, 0.4)"; // Gray
}

/**
 * AccessibilityBoundsOverlay - Displays accessibility element bounds on a screenshot
 *
 * This component renders colored rectangles for each accessibility node's bounds,
 * allowing users to visually identify and select elements from a captured screenshot.
 *
 * @example
 * ```tsx
 * <AccessibilityBoundsOverlay
 *   snapshot={accessibilitySnapshot}
 *   screenshotUrl="/screenshot.png"
 *   selectedRef={selectedRef}
 *   onSelectNode={(node) => console.log('Selected:', node.ref)}
 *   interactiveOnly={true}
 *   showLabels={true}
 * />
 * ```
 */
export function AccessibilityBoundsOverlay({
  snapshot,
  screenshotUrl,
  selectedRef,
  hoveredRef,
  onSelectNode,
  onHoverNode,
  interactiveOnly = true,
  showLabels = true,
  overlayOpacity = 0.5,
  className,
}: AccessibilityBoundsOverlayProps) {
  const [internalHoveredRef, setInternalHoveredRef] = useState<string | null>(
    null
  );
  const [imageSize, setImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Collect all nodes with bounds
  const nodesWithBounds = useMemo(() => {
    if (!snapshot?.root) return [];

    const result: BoundsNode[] = [];

    const collectNodes = (node: AccessibilityNode) => {
      // Filter by interactivity if enabled
      if (interactiveOnly && !node.is_interactive) {
        // Still collect children
        for (const child of node.children ?? []) {
          collectNodes(child);
        }
        return;
      }

      // Only include nodes with valid bounds
      if (node.bounds && node.bounds.width > 0 && node.bounds.height > 0) {
        result.push({
          node,
          x: node.bounds.x,
          y: node.bounds.y,
          width: node.bounds.width,
          height: node.bounds.height,
        });
      }

      // Collect children
      for (const child of node.children ?? []) {
        collectNodes(child);
      }
    };

    collectNodes(snapshot.root);
    return result;
  }, [snapshot, interactiveOnly]);

  // Handle image load to get dimensions
  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.target as HTMLImageElement;
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    },
    []
  );

  // Handle node click
  const handleNodeClick = useCallback(
    (boundsNode: BoundsNode) => {
      onSelectNode?.(boundsNode.node);
    },
    [onSelectNode]
  );

  // Handle node hover
  const handleNodeHover = useCallback(
    (boundsNode: BoundsNode | null) => {
      const ref = boundsNode?.node.ref ?? null;
      setInternalHoveredRef(ref);
      onHoverNode?.(boundsNode?.node ?? null);
    },
    [onHoverNode]
  );

  // Effective hovered ref (external or internal)
  const effectiveHoveredRef = hoveredRef ?? internalHoveredRef;

  // No data state
  if (!snapshot) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-full bg-surface-canvas/50 border border-dashed border-border-subtle rounded-lg",
          className
        )}
      >
        <p className="text-sm text-muted-foreground">
          No accessibility data. Capture a tree first.
        </p>
      </div>
    );
  }

  // No screenshot state - show bounds in a grid
  if (!screenshotUrl) {
    return (
      <div
        className={cn(
          "relative h-full bg-surface-canvas/50 border border-border-subtle rounded-lg overflow-hidden",
          className
        )}
      >
        <div className="absolute inset-0 p-4">
          <div className="text-xs text-muted-foreground mb-4">
            {nodesWithBounds.length} elements with bounds (no screenshot
            available)
          </div>
          <div className="space-y-1 overflow-auto h-[calc(100%-2rem)]">
            {nodesWithBounds.slice(0, 50).map((boundsNode) => {
              const isSelected = selectedRef === boundsNode.node.ref;
              const isHovered = effectiveHoveredRef === boundsNode.node.ref;

              return (
                <div
                  role="button"
                  tabIndex={0}
                  key={boundsNode.node.ref}
                  onClick={() => handleNodeClick(boundsNode)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).click();
                    }
                  }}
                  onMouseEnter={() => handleNodeHover(boundsNode)}
                  onMouseLeave={() => handleNodeHover(null)}
                  className={cn(
                    "p-2 rounded cursor-pointer transition-colors flex items-center gap-2 text-sm",
                    isSelected && "bg-purple-500/20 border border-purple-500",
                    isHovered && !isSelected && "bg-surface-raised",
                    !isSelected && !isHovered && "bg-surface-canvas/50"
                  )}
                >
                  <span className="font-mono text-xs text-purple-400">
                    {boundsNode.node.ref}
                  </span>
                  <span className="text-muted-foreground">
                    {boundsNode.node.role}
                  </span>
                  {boundsNode.node.name && (
                    <span className="truncate text-text-default">
                      {boundsNode.node.name}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {boundsNode.width}x{boundsNode.height}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-auto h-full", className)}>
      {/* Screenshot image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={screenshotUrl}
        alt="Screenshot with accessibility bounds"
        onLoad={handleImageLoad}
        className="block"
        style={{ maxWidth: "100%", height: "auto" }}
      />

      {/* Bounds overlay container */}
      {imageSize && (
        <svg
          className="absolute top-0 left-0 pointer-events-none"
          style={{
            width: imageSize.width,
            height: imageSize.height,
            maxWidth: "100%",
          }}
          viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
          preserveAspectRatio="xMinYMin meet"
        >
          {/* Render all bounds rectangles */}
          {nodesWithBounds.map((boundsNode) => {
            const isSelected = selectedRef === boundsNode.node.ref;
            const isHovered = effectiveHoveredRef === boundsNode.node.ref;
            const roleColor = getRoleColor(boundsNode.node.role);

            return (
              <g key={boundsNode.node.ref}>
                {/* Bounding box rectangle */}
                <rect
                  x={boundsNode.x}
                  y={boundsNode.y}
                  width={boundsNode.width}
                  height={boundsNode.height}
                  fill={isSelected || isHovered ? roleColor : "transparent"}
                  stroke={
                    isSelected
                      ? "#a855f7"
                      : isHovered
                        ? "#8b5cf6"
                        : roleColor.replace(/0\.[45]/, "0.8")
                  }
                  strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
                  style={{
                    opacity: isSelected || isHovered ? 1 : overlayOpacity,
                    pointerEvents: "auto",
                    cursor: "pointer",
                  }}
                  onClick={() => handleNodeClick(boundsNode)}
                  onMouseEnter={() => handleNodeHover(boundsNode)}
                  onMouseLeave={() => handleNodeHover(null)}
                />

                {/* Ref label */}
                {showLabels &&
                  (isSelected || isHovered || overlayOpacity > 0.3) && (
                    <>
                      {/* Label background */}
                      <rect
                        x={boundsNode.x}
                        y={boundsNode.y - 16}
                        width={boundsNode.node.ref.length * 8 + 8}
                        height={14}
                        fill={
                          isSelected
                            ? "#a855f7"
                            : isHovered
                              ? "#8b5cf6"
                              : "#374151"
                        }
                        rx={2}
                        style={{ pointerEvents: "none" }}
                      />
                      {/* Label text */}
                      <text
                        x={boundsNode.x + 4}
                        y={boundsNode.y - 5}
                        fill="white"
                        fontSize="10"
                        fontFamily="monospace"
                        style={{ pointerEvents: "none" }}
                      >
                        {boundsNode.node.ref}
                      </text>
                    </>
                  )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export default AccessibilityBoundsOverlay;
