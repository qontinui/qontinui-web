/**
 * Canvas Properties Panel - Main properties panel for workflow canvas
 *
 * Displays context-aware properties:
 * - Single node selection: Show node properties
 * - Multi-node selection: Show common properties
 * - Edge selection: Show connection properties
 * - No selection: Show workflow properties
 *
 * Features:
 * - Resizable panel
 * - Collapsible sections
 * - Unsaved changes indicator
 * - Multiple positions (right, bottom, floating)
 */

"use client";

import React, { useState, useEffect, useRef } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { usePropertiesPanelStore } from "@/stores/properties-panel-store";
import { PropertyEditorWrapper } from "./property-adapter";
import { WorkflowProperties } from "./WorkflowProperties";
import { MultiSelectProperties } from "./MultiSelectProperties";
import { ConnectionProperties } from "./ConnectionProperties";
import { PropertyHistory } from "./PropertyHistory";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Save,
  RotateCcw,
  Settings,
  History,
  AlertCircle,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { actionConfigRegistry } from "@/components/action-properties/ActionConfigRegistry";

export interface CanvasPropertiesPanelProps {
  position?: "right" | "bottom" | "floating";
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  className?: string;
}

export const CanvasPropertiesPanel: React.FC<CanvasPropertiesPanelProps> = ({
  position: propPosition,
  collapsible = true,
  defaultCollapsed = false,
  className = "",
}) => {
  const selectedNodes = useCanvasStore((state) => state.selectedNodes);
  const selectedEdges = useCanvasStore((state) => state.selectedEdges);
  const workflow = useCanvasStore((state) => state.workflow);

  const panelStore = usePropertiesPanelStore();
  const {
    isOpen,
    position,
    width,
    height,
    setPosition,
    setWidth,
    setHeight,
    toggleOpen,
    hasUnsavedChanges,
  } = panelStore;

  const [activeTab, setActiveTab] = useState<string>("properties");
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Use prop position or store position
  const effectivePosition = propPosition || position;

  // Initialize collapsed state
  useEffect(() => {
    if (defaultCollapsed && isOpen) {
      toggleOpen();
    }
  }, []);

  // Handle resize start
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width,
      height,
    };
  };

  // Handle resize move
  useEffect(() => {
    if (!isResizing || !resizeStartRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStartRef.current) return;

      const deltaX = e.clientX - resizeStartRef.current.x;
      const deltaY = e.clientY - resizeStartRef.current.y;

      if (effectivePosition === "right") {
        const newWidth = resizeStartRef.current.width - deltaX;
        setWidth(newWidth);
      } else if (effectivePosition === "bottom") {
        const newHeight = resizeStartRef.current.height - deltaY;
        setHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, effectivePosition, setWidth, setHeight]);

  // Determine what to show based on selection
  const getContent = () => {
    // Single node selected
    if (selectedNodes.length === 1) {
      const nodeId = selectedNodes[0];
      const action = workflow?.actions.find((a) => a.id === nodeId);

      if (!action) {
        return (
          <div className="p-4 text-gray-400 text-sm">
            Action not found: {nodeId}
          </div>
        );
      }

      // Get the property component for this action type
      const PropertyComponent = actionConfigRegistry.getComponent(
        action.type as any
      );

      if (!PropertyComponent) {
        return (
          <div className="p-4 text-gray-400 text-sm">
            No property editor for action type: {action.type}
          </div>
        );
      }

      return (
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col"
        >
          <TabsList className="w-full justify-start border-b border-gray-700 rounded-none bg-transparent p-0">
            <TabsTrigger value="properties" className="rounded-none">
              <Settings className="w-3 h-3 mr-1.5" />
              Properties
            </TabsTrigger>
            <TabsTrigger value="history" className="rounded-none">
              <History className="w-3 h-3 mr-1.5" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="properties"
            className="flex-1 overflow-y-auto m-0 p-4"
          >
            <div className="space-y-4">
              {/* Action Type Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-200">
                    {action.type}
                  </h3>
                  <p className="text-xs text-gray-500 font-mono">{action.id}</p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {actionConfigRegistry.getDisplayName(action.type as unknown)}
                </Badge>
              </div>

              <Separator className="bg-gray-700" />

              {/* Property Editor */}
              <PropertyEditorWrapper
                actionId={nodeId!}
                component={PropertyComponent}
              />
            </div>
          </TabsContent>

          <TabsContent value="history" className="flex-1 overflow-y-auto m-0">
            <PropertyHistory actionId={nodeId!} />
          </TabsContent>
        </Tabs>
      );
    }

    // Multiple nodes selected
    if (selectedNodes.length > 1) {
      return <MultiSelectProperties actionIds={selectedNodes} />;
    }

    // Single edge selected
    if (selectedEdges.length === 1 && selectedEdges[0]) {
      return <ConnectionProperties edgeId={selectedEdges[0]} />;
    }

    // No selection - show workflow properties
    return <WorkflowProperties />;
  };

  if (!isOpen && collapsible) {
    // Show collapsed toggle button
    return (
      <div
        className={`fixed ${
          effectivePosition === "right"
            ? "right-0 top-1/2 -translate-y-1/2"
            : effectivePosition === "bottom"
              ? "bottom-0 left-1/2 -translate-x-1/2"
              : "right-4 top-4"
        } z-50 ${className}`}
      >
        <Button
          size="sm"
          onClick={toggleOpen}
          className="bg-gray-800 hover:bg-gray-700 border border-gray-700"
        >
          {effectivePosition === "right" ? (
            <ChevronLeft className="w-4 h-4" />
          ) : (
            <ChevronUp className="w-4 h-4" />
          )}
          <span className="ml-1 text-xs">Properties</span>
        </Button>
      </div>
    );
  }

  // Panel styles based on position
  const panelStyles: React.CSSProperties = {
    ...(effectivePosition === "right" && {
      width: `${width}px`,
      height: "100%",
      borderLeft: "1px solid rgb(55, 65, 81)",
    }),
    ...(effectivePosition === "bottom" && {
      width: "100%",
      height: `${height}px`,
      borderTop: "1px solid rgb(55, 65, 81)",
    }),
  };

  return (
    <div
      ref={panelRef}
      className={`bg-[#1e1e1e] flex flex-col ${
        effectivePosition === "right"
          ? "fixed right-0 top-0"
          : effectivePosition === "bottom"
            ? "fixed bottom-0 left-0"
            : "fixed"
      } z-40 ${className}`}
      style={panelStyles}
    >
      {/* Resize Handle */}
      {effectivePosition === "right" && (
        <div
          className={`absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500 ${
            isResizing ? "bg-blue-500" : ""
          }`}
          onMouseDown={handleResizeStart}
        />
      )}
      {effectivePosition === "bottom" && (
        <div
          className={`absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-blue-500 ${
            isResizing ? "bg-blue-500" : ""
          }`}
          onMouseDown={handleResizeStart}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-200">Properties</h2>
          {hasUnsavedChanges && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-yellow-400" />
              <span className="text-xs text-yellow-400">Unsaved changes</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Position Toggle */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const newPosition =
                effectivePosition === "right"
                  ? "bottom"
                  : effectivePosition === "bottom"
                    ? "floating"
                    : "right";
              setPosition(newPosition);
            }}
            className="h-7 w-7 p-0"
            title="Change position"
          >
            {effectivePosition === "floating" ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </Button>

          {/* Close Button */}
          {collapsible && (
            <Button
              size="sm"
              variant="ghost"
              onClick={toggleOpen}
              className="h-7 w-7 p-0"
              title="Close panel"
            >
              {effectivePosition === "right" ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">{getContent()}</div>

      {/* Footer - Unsaved Changes Warning */}
      {hasUnsavedChanges && (
        <div className="px-4 py-3 border-t border-gray-700 bg-yellow-900/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-yellow-200">
              <AlertCircle className="w-4 h-4" />
              <span>You have unsaved changes</span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => console.log("Discard changes")}
                className="h-7 text-xs"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Discard
              </Button>
              <Button
                size="sm"
                onClick={() => console.log("Save changes")}
                className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
              >
                <Save className="w-3 h-3 mr-1" />
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
