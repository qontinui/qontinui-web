"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Wifi,
  WifiOff,
  Radio,
  Eye,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  GripVertical,
  Move,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionState } from "@/hooks/useExecutionEvents";
import type {
  CanvasMode,
  ActiveStateInfo,
  VisibleFoundImage,
  ConfigImage,
} from "../ActiveStatesCanvas-types";

interface LegendPanelProps {
  mode: CanvasMode;
  activeStatesInfo: ActiveStateInfo[];
  visibleFoundImages: VisibleFoundImage[];
  configImages: ConfigImage[];
  connectionState?: ConnectionState;
  highlightStateId?: string;
  isLegendCollapsed: boolean;
  setIsLegendCollapsed: (collapsed: boolean) => void;
  isLegendFloating: boolean;
  setIsLegendFloating: (floating: boolean) => void;
  legendPosition: { x: number; y: number };
  handleLegendDragStart: (e: React.MouseEvent) => void;
}

export function LegendPanel({
  mode,
  activeStatesInfo,
  visibleFoundImages,
  configImages,
  connectionState,
  highlightStateId,
  isLegendCollapsed,
  setIsLegendCollapsed,
  isLegendFloating,
  setIsLegendFloating,
  legendPosition,
  handleLegendDragStart,
}: LegendPanelProps) {
  const isLiveMode = connectionState !== undefined;
  const hasFoundImages = visibleFoundImages.length > 0;

  if (mode === "perception") {
    return (
      <PerceptionLegend
        activeStatesInfo={activeStatesInfo}
        visibleFoundImages={visibleFoundImages}
        connectionState={connectionState}
        isLiveMode={isLiveMode}
        hasFoundImages={hasFoundImages}
        isLegendCollapsed={isLegendCollapsed}
        setIsLegendCollapsed={setIsLegendCollapsed}
        isLegendFloating={isLegendFloating}
        setIsLegendFloating={setIsLegendFloating}
        legendPosition={legendPosition}
        handleLegendDragStart={handleLegendDragStart}
      />
    );
  }

  return (
    <ConfigLegend
      activeStatesInfo={activeStatesInfo}
      configImages={configImages}
      highlightStateId={highlightStateId}
      isLegendCollapsed={isLegendCollapsed}
      setIsLegendCollapsed={setIsLegendCollapsed}
      isLegendFloating={isLegendFloating}
      setIsLegendFloating={setIsLegendFloating}
      legendPosition={legendPosition}
      handleLegendDragStart={handleLegendDragStart}
    />
  );
}

// --- Shared sub-components ---

interface LegendHeaderProps {
  icon: React.ReactNode;
  title: string;
  isLegendCollapsed: boolean;
  setIsLegendCollapsed: (collapsed: boolean) => void;
  isLegendFloating: boolean;
  setIsLegendFloating: (floating: boolean) => void;
  handleLegendDragStart: (e: React.MouseEvent) => void;
  trailingContent?: React.ReactNode;
}

function LegendHeader({
  icon,
  title,
  isLegendCollapsed,
  setIsLegendCollapsed,
  isLegendFloating,
  setIsLegendFloating,
  handleLegendDragStart,
  trailingContent,
}: LegendHeaderProps) {
  return (
    <div
      className={cn("flex items-center gap-2", !isLegendCollapsed && "mb-2")}
    >
      {isLegendFloating && (
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              (e.currentTarget as HTMLElement).click();
            }
          }}
          className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 hover:bg-muted rounded"
          onMouseDown={handleLegendDragStart}
        >
          <GripVertical className="h-3 w-3 text-muted-foreground" />
        </div>
      )}
      {icon}
      <span className="text-sm font-medium">{title}</span>
      {trailingContent}
      <div className="flex items-center gap-0.5 ml-auto">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => setIsLegendFloating(!isLegendFloating)}
          title={isLegendFloating ? "Dock panel" : "Float panel"}
        >
          <Move className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => setIsLegendCollapsed(!isLegendCollapsed)}
          title={isLegendCollapsed ? "Expand" : "Collapse"}
        >
          {isLegendCollapsed ? (
            <PanelLeftOpen className="h-3 w-3" />
          ) : (
            <PanelLeftClose className="h-3 w-3" />
          )}
        </Button>
      </div>
    </div>
  );
}

interface LegendContainerProps {
  isLegendCollapsed: boolean;
  isLegendFloating: boolean;
  legendPosition: { x: number; y: number };
  children: React.ReactNode;
}

function LegendContainer({
  isLegendCollapsed,
  isLegendFloating,
  legendPosition,
  children,
}: LegendContainerProps) {
  return (
    <div
      className={cn(
        "absolute z-10 bg-background/95 backdrop-blur-sm rounded-lg shadow-lg",
        isLegendFloating ? "border-2" : "",
        isLegendCollapsed ? "p-2" : "p-3",
        !isLegendFloating && "max-w-[280px]"
      )}
      style={
        isLegendFloating
          ? { left: legendPosition.x, top: legendPosition.y }
          : { left: 16, top: 16 }
      }
    >
      {children}
    </div>
  );
}

// --- Perception Legend ---

interface PerceptionLegendProps {
  activeStatesInfo: ActiveStateInfo[];
  visibleFoundImages: VisibleFoundImage[];
  connectionState?: ConnectionState;
  isLiveMode: boolean;
  hasFoundImages: boolean;
  isLegendCollapsed: boolean;
  setIsLegendCollapsed: (collapsed: boolean) => void;
  isLegendFloating: boolean;
  setIsLegendFloating: (floating: boolean) => void;
  legendPosition: { x: number; y: number };
  handleLegendDragStart: (e: React.MouseEvent) => void;
}

function PerceptionLegend({
  activeStatesInfo,
  visibleFoundImages,
  connectionState,
  isLiveMode,
  hasFoundImages,
  isLegendCollapsed,
  setIsLegendCollapsed,
  isLegendFloating,
  setIsLegendFloating,
  legendPosition,
  handleLegendDragStart,
}: PerceptionLegendProps) {
  return (
    <LegendContainer
      isLegendCollapsed={isLegendCollapsed}
      isLegendFloating={isLegendFloating}
      legendPosition={legendPosition}
    >
      <LegendHeader
        icon={<Eye className="h-4 w-4 text-muted-foreground" />}
        title="Active States"
        isLegendCollapsed={isLegendCollapsed}
        setIsLegendCollapsed={setIsLegendCollapsed}
        isLegendFloating={isLegendFloating}
        setIsLegendFloating={setIsLegendFloating}
        handleLegendDragStart={handleLegendDragStart}
        trailingContent={
          isLiveMode && !isLegendCollapsed ? (
            <span className="ml-auto">
              {connectionState === "connected" ? (
                <Radio className="h-3 w-3 text-green-500 animate-pulse" />
              ) : connectionState === "connecting" ||
                connectionState === "reconnecting" ? (
                <Wifi className="h-3 w-3 text-yellow-500 animate-pulse" />
              ) : (
                <WifiOff className="h-3 w-3 text-muted-foreground" />
              )}
            </span>
          ) : undefined
        }
      />

      {!isLegendCollapsed && (
        <>
          {activeStatesInfo.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active states</p>
          ) : (
            <div className="space-y-1.5">
              {activeStatesInfo.map(({ id, name, color }) => {
                // Count found images for this state
                const foundCount = visibleFoundImages.filter(
                  (img) => img.stateId === id
                ).length;

                return (
                  <div key={id} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: color.border }}
                    />
                    <span className="text-xs truncate flex-1" title={name}>
                      {name}
                    </span>
                    {foundCount > 0 && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: color.bg,
                          color: color.border,
                          fontWeight: 500,
                        }}
                      >
                        {foundCount}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
            {hasFoundImages
              ? `${visibleFoundImages.length} image(s) found`
              : "No images found yet"}
          </div>
        </>
      )}
    </LegendContainer>
  );
}

// --- Config Legend ---

interface ConfigLegendProps {
  activeStatesInfo: ActiveStateInfo[];
  configImages: ConfigImage[];
  highlightStateId?: string;
  isLegendCollapsed: boolean;
  setIsLegendCollapsed: (collapsed: boolean) => void;
  isLegendFloating: boolean;
  setIsLegendFloating: (floating: boolean) => void;
  legendPosition: { x: number; y: number };
  handleLegendDragStart: (e: React.MouseEvent) => void;
}

function ConfigLegend({
  activeStatesInfo,
  configImages,
  highlightStateId,
  isLegendCollapsed,
  setIsLegendCollapsed,
  isLegendFloating,
  setIsLegendFloating,
  legendPosition,
  handleLegendDragStart,
}: ConfigLegendProps) {
  return (
    <LegendContainer
      isLegendCollapsed={isLegendCollapsed}
      isLegendFloating={isLegendFloating}
      legendPosition={legendPosition}
    >
      <LegendHeader
        icon={<Layers className="h-4 w-4 text-muted-foreground" />}
        title="Selected States"
        isLegendCollapsed={isLegendCollapsed}
        setIsLegendCollapsed={setIsLegendCollapsed}
        isLegendFloating={isLegendFloating}
        setIsLegendFloating={setIsLegendFloating}
        handleLegendDragStart={handleLegendDragStart}
      />

      {!isLegendCollapsed && (
        <>
          {activeStatesInfo.length === 0 ? (
            <p className="text-xs text-muted-foreground">No states selected</p>
          ) : (
            <div className="space-y-1.5">
              {activeStatesInfo.map(({ id, name, color }) => {
                // Count config images for this state
                const imageCount = configImages.filter(
                  (img) => img.stateId === id
                ).length;
                const isHighlighted = id === highlightStateId;

                return (
                  <div
                    key={id}
                    className={cn(
                      "flex items-center gap-2",
                      isHighlighted && "font-medium"
                    )}
                  >
                    <div
                      className={cn(
                        "w-3 h-3 rounded-sm flex-shrink-0",
                        isHighlighted && "ring-2 ring-offset-1 ring-current"
                      )}
                      style={{ backgroundColor: color.border }}
                    />
                    <span className="text-xs truncate flex-1" title={name}>
                      {name}
                    </span>
                    {imageCount > 0 && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: color.bg,
                          color: color.border,
                          fontWeight: 500,
                        }}
                      >
                        {imageCount}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
            {configImages.length} image(s) at configured positions
          </div>
        </>
      )}
    </LegendContainer>
  );
}
