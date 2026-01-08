/**
 * CanvasLayout Component
 *
 * Full-screen layout for canvas-based views like workflow editors,
 * state machine builders, and other visual tools.
 *
 * Features:
 * - No page-level scrolling (content fills viewport)
 * - Optional toolbar slot (top)
 * - Optional left panel slot (resizable)
 * - Optional right panel slot (resizable)
 * - Canvas fills remaining space
 *
 * Usage:
 *   <CanvasLayout
 *     toolbar={<Toolbar />}
 *     leftPanel={<NodePalette />}
 *     rightPanel={<PropertiesPanel />}
 *   >
 *     <ReactFlowCanvas />
 *   </CanvasLayout>
 */

"use client";

import { forwardRef, type ReactNode, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

export interface CanvasLayoutProps {
  /** Main canvas content */
  children: ReactNode;
  /** Optional toolbar at the top */
  toolbar?: ReactNode;
  /** Optional left panel (sidebar) */
  leftPanel?: ReactNode;
  /** Optional right panel (properties/inspector) */
  rightPanel?: ReactNode;
  /** Initial width of left panel */
  leftPanelWidth?: number;
  /** Initial width of right panel */
  rightPanelWidth?: number;
  /** Minimum panel width */
  minPanelWidth?: number;
  /** Maximum panel width */
  maxPanelWidth?: number;
  /** Whether left panel is collapsible */
  leftPanelCollapsible?: boolean;
  /** Whether right panel is collapsible */
  rightPanelCollapsible?: boolean;
  /** Collapsed state of left panel (controlled) */
  leftPanelCollapsed?: boolean;
  /** Collapsed state of right panel (controlled) */
  rightPanelCollapsed?: boolean;
  /** Callback when left panel collapse state changes */
  onLeftPanelCollapse?: (collapsed: boolean) => void;
  /** Callback when right panel collapse state changes */
  onRightPanelCollapse?: (collapsed: boolean) => void;
  /** Background variant for the canvas area */
  background?: "canvas" | "raised" | "dots" | "transparent";
  /** Additional class names */
  className?: string;
  /** Class names for the canvas area */
  canvasClassName?: string;
}

const backgroundClasses = {
  canvas: "bg-surface-canvas",
  raised: "bg-surface-raised",
  dots: "bg-surface-canvas dot-grid",
  transparent: "bg-transparent",
};

/**
 * CanvasLayout provides a full-screen workspace for visual tools.
 *
 * The layout fills its parent completely with no scrolling - panels
 * and canvas manage their own internal scrolling if needed.
 *
 * @example
 * // Basic canvas with toolbar
 * <CanvasLayout toolbar={<EditorToolbar />}>
 *   <FlowCanvas />
 * </CanvasLayout>
 *
 * @example
 * // Full workspace with panels
 * <CanvasLayout
 *   toolbar={<Toolbar />}
 *   leftPanel={<NodeLibrary />}
 *   rightPanel={<Inspector />}
 *   leftPanelWidth={280}
 *   rightPanelWidth={320}
 * >
 *   <WorkflowEditor />
 * </CanvasLayout>
 */
export const CanvasLayout = forwardRef<HTMLDivElement, CanvasLayoutProps>(
  (
    {
      children,
      toolbar,
      leftPanel,
      rightPanel,
      leftPanelWidth: initialLeftWidth = 280,
      rightPanelWidth: initialRightWidth = 320,
      minPanelWidth = 200,
      maxPanelWidth = 500,
      leftPanelCollapsible = true,
      rightPanelCollapsible = true,
      leftPanelCollapsed: controlledLeftCollapsed,
      rightPanelCollapsed: controlledRightCollapsed,
      onLeftPanelCollapse,
      onRightPanelCollapse,
      background = "canvas",
      className,
      canvasClassName,
    },
    ref
  ) => {
    // Internal collapse state (used if not controlled)
    const [internalLeftCollapsed, setInternalLeftCollapsed] = useState(false);
    const [internalRightCollapsed, setInternalRightCollapsed] = useState(false);

    // Use controlled or internal state
    const leftCollapsed = controlledLeftCollapsed ?? internalLeftCollapsed;
    const rightCollapsed = controlledRightCollapsed ?? internalRightCollapsed;

    // Panel width state (setters available for future drag-resize feature)
    const [leftWidth] = useState(initialLeftWidth);
    const [rightWidth] = useState(initialRightWidth);

    // Handle collapse toggling
    const toggleLeftPanel = useCallback(() => {
      const newValue = !leftCollapsed;
      if (onLeftPanelCollapse) {
        onLeftPanelCollapse(newValue);
      } else {
        setInternalLeftCollapsed(newValue);
      }
    }, [leftCollapsed, onLeftPanelCollapse]);

    const toggleRightPanel = useCallback(() => {
      const newValue = !rightCollapsed;
      if (onRightPanelCollapse) {
        onRightPanelCollapse(newValue);
      } else {
        setInternalRightCollapsed(newValue);
      }
    }, [rightCollapsed, onRightPanelCollapse]);

    // Clamp panel width
    const clampWidth = (width: number) =>
      Math.max(minPanelWidth, Math.min(maxPanelWidth, width));

    return (
      <div
        ref={ref}
        className={cn(
          // Fill parent completely, no overflow
          "h-full w-full flex flex-col overflow-hidden",
          backgroundClasses[background],
          className
        )}
      >
        {/* Toolbar (fixed at top) */}
        {toolbar && (
          <div className="shrink-0 border-b border-border-subtle">
            {toolbar}
          </div>
        )}

        {/* Main content area (panels + canvas) */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left panel */}
          {leftPanel && (
            <div
              className={cn(
                "shrink-0 border-r border-border-subtle bg-surface-raised overflow-hidden transition-all duration-200",
                leftCollapsed && "w-0 border-r-0"
              )}
              style={{
                width: leftCollapsed ? 0 : clampWidth(leftWidth),
              }}
            >
              <div className="h-full overflow-y-auto scrollbar-dark">
                {leftPanel}
              </div>
            </div>
          )}

          {/* Collapse button for left panel */}
          {leftPanel && leftPanelCollapsible && (
            <button
              type="button"
              onClick={toggleLeftPanel}
              className={cn(
                "shrink-0 w-4 flex items-center justify-center",
                "bg-surface-raised hover:bg-surface-hover border-r border-border-subtle",
                "text-muted-foreground hover:text-foreground transition-colors"
              )}
              aria-label={
                leftCollapsed ? "Expand left panel" : "Collapse left panel"
              }
            >
              <svg
                className={cn(
                  "w-3 h-3 transition-transform",
                  leftCollapsed && "rotate-180"
                )}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
          )}

          {/* Canvas area */}
          <div
            className={cn(
              "flex-1 min-w-0 overflow-hidden relative",
              canvasClassName
            )}
          >
            {children}
          </div>

          {/* Collapse button for right panel */}
          {rightPanel && rightPanelCollapsible && (
            <button
              type="button"
              onClick={toggleRightPanel}
              className={cn(
                "shrink-0 w-4 flex items-center justify-center",
                "bg-surface-raised hover:bg-surface-hover border-l border-border-subtle",
                "text-muted-foreground hover:text-foreground transition-colors"
              )}
              aria-label={
                rightCollapsed ? "Expand right panel" : "Collapse right panel"
              }
            >
              <svg
                className={cn(
                  "w-3 h-3 transition-transform",
                  !rightCollapsed && "rotate-180"
                )}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
          )}

          {/* Right panel */}
          {rightPanel && (
            <div
              className={cn(
                "shrink-0 border-l border-border-subtle bg-surface-raised overflow-hidden transition-all duration-200",
                rightCollapsed && "w-0 border-l-0"
              )}
              style={{
                width: rightCollapsed ? 0 : clampWidth(rightWidth),
              }}
            >
              <div className="h-full overflow-y-auto scrollbar-dark">
                {rightPanel}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);

CanvasLayout.displayName = "CanvasLayout";

export default CanvasLayout;
