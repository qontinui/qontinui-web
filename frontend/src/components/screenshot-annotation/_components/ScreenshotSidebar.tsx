"use client";

import React from "react";
import {
  MousePointer,
  Square,
  ImageIcon,
  Upload,
  FolderOpen,
  Camera,
  Monitor,
  Loader2,
} from "lucide-react";
import {
  Screenshot,
  ScreenshotRegion,
  ScreenshotLocation,
} from "../../../types/Screenshot";
import { State } from "../../../contexts/automation-context/types";
import AnchorRegionCreator from "../../ScreenshotTab/AnchorRegionCreator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ScreenshotSelector } from "../../screenshot-selector";
import { MonitorInfo } from "../screenshot-annotation-types";

interface ScreenshotSidebarProps {
  screenshots: Screenshot[];
  selectedScreenshot: Screenshot | null;
  states: State[];
  isCapturing: boolean;
  showMonitorMenu: boolean;
  availableMonitors: MonitorInfo[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  screenshotSelectorTriggerRef: React.RefObject<HTMLButtonElement | null>;
  monitorMenuRef: React.RefObject<HTMLDivElement | null>;
  onSelectScreenshot: (screenshot: Screenshot) => void;
  onSelectProjectScreenshot: (screenshotId: string) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenMonitorMenu: () => void;
  onCaptureFromScreen: (monitorIndex: number | null) => void;
  onRegionCreate: (region: ScreenshotRegion) => void;
}

const ScreenshotSidebar: React.FC<ScreenshotSidebarProps> = ({
  screenshots,
  selectedScreenshot,
  states,
  isCapturing,
  showMonitorMenu,
  availableMonitors,
  fileInputRef,
  screenshotSelectorTriggerRef,
  monitorMenuRef,
  onSelectScreenshot,
  onSelectProjectScreenshot,
  onFileSelect,
  onOpenMonitorMenu,
  onCaptureFromScreen,
  onRegionCreate,
}) => {
  return (
    <div className="w-64 border-r border-border-subtle bg-surface-raised/50 flex flex-col flex-shrink-0">
      {/* Screenshot Actions */}
      <div className="p-3 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-secondary">
            Screenshots
          </h3>
        </div>
        <div className="space-y-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-3 py-2 bg-brand-primary text-black rounded-md hover:bg-brand-primary/90 text-sm flex items-center justify-center gap-2 font-medium"
          >
            <Upload className="w-4 h-4" />
            Upload Image
          </button>
          <button
            onClick={() => screenshotSelectorTriggerRef.current?.click()}
            className="w-full px-3 py-2 bg-brand-success text-black rounded-md hover:bg-brand-success/90 text-sm flex items-center justify-center gap-2 font-medium"
          >
            <FolderOpen className="w-4 h-4" />
            From Project
          </button>

          {/* Capture from Screen button */}
          <div className="relative" ref={monitorMenuRef}>
            <button
              onClick={onOpenMonitorMenu}
              disabled={isCapturing}
              className="w-full px-3 py-2 bg-brand-secondary text-white rounded-md hover:bg-brand-secondary/90 text-sm flex items-center justify-center gap-2 font-medium disabled:opacity-50"
            >
              {isCapturing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              {isCapturing ? "Capturing..." : "Capture Screen"}
            </button>

            {showMonitorMenu && (
              <div className="absolute left-0 right-0 mt-2 bg-surface-raised rounded-md shadow-lg z-10 border border-border-default">
                <div className="py-1">
                  <div className="px-3 py-2 text-xs text-text-muted border-b border-border-default">
                    Select monitor
                  </div>
                  {availableMonitors.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-text-muted flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading...
                    </div>
                  ) : (
                    <>
                      {availableMonitors.map((monitor) => (
                        <button
                          key={monitor.index}
                          onClick={() => onCaptureFromScreen(monitor.index)}
                          className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-surface-overlay flex items-center gap-2"
                        >
                          <Monitor className="w-4 h-4" />
                          <span className="flex-1">
                            Monitor {monitor.index + 1}
                            {monitor.is_primary && (
                              <span className="text-xs text-brand-success ml-1">
                                (Primary)
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-text-muted">
                            {monitor.width}x{monitor.height}
                          </span>
                        </button>
                      ))}
                      {availableMonitors.length > 1 && (
                        <>
                          <div className="border-t border-border-default my-1"></div>
                          <button
                            onClick={() => onCaptureFromScreen(null)}
                            className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-surface-overlay flex items-center gap-2"
                          >
                            <Monitor className="w-4 h-4" />
                            All Monitors
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFileSelect}
          className="hidden"
        />

        {/* Hidden Screenshot Selector Trigger */}
        <ScreenshotSelector
          selectedScreenshot={selectedScreenshot?.id || ""}
          onSelectScreenshot={onSelectProjectScreenshot}
          multiSelect={false}
          allowUpload={false}
          trigger={
            <button
              ref={screenshotSelectorTriggerRef}
              style={{ display: "none" }}
            />
          }
        />
      </div>

      <ScrollArea className="flex-1 h-full">
        <div className="p-4">
          {/* Anchor Region Creator */}
          {selectedScreenshot &&
            selectedScreenshot.locations.filter(
              (l: ScreenshotLocation) => l.anchor
            ).length >= 2 && (
              <div className="mb-4">
                <AnchorRegionCreator
                  locations={selectedScreenshot.locations}
                  onRegionCreate={onRegionCreate}
                />
              </div>
            )}

          {screenshots.length === 0 ? (
            <div className="text-center py-8 text-text-muted">
              <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No screenshots</p>
              <p className="text-xs mt-1">Upload or select from project</p>
            </div>
          ) : (
            <div className="space-y-2">
              {screenshots.map((screenshot) => (
                <div
                  key={screenshot.id}
                  className={`group relative p-3 rounded-md cursor-pointer transition-all ${
                    selectedScreenshot?.id === screenshot.id
                      ? "bg-surface-raised border-2 border-brand-primary ring-2 ring-brand-primary/50"
                      : "bg-surface-raised border-2 border-border-default hover:border-border-subtle"
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectScreenshot(screenshot)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectScreenshot(screenshot);
                    }
                  }}
                >
                  <div className="aspect-video relative overflow-hidden rounded bg-surface-overlay mb-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={screenshot.imageData}
                      alt={screenshot.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <p className="text-sm font-medium truncate text-text-secondary mb-2">
                    {screenshot.name}
                  </p>

                  <div className="flex items-center gap-2 text-xs">
                    {screenshot.regions.length > 0 && (
                      <div className="flex items-center gap-1 text-emerald-500">
                        <Square className="w-3 h-3" />
                        <span>{screenshot.regions.length}</span>
                      </div>
                    )}
                    {screenshot.locations.length > 0 && (
                      <div className="flex items-center gap-1 text-red-500">
                        <MousePointer className="w-3 h-3" />
                        <span>{screenshot.locations.length}</span>
                      </div>
                    )}
                  </div>

                  {screenshot.associatedStates.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {screenshot.associatedStates.map((stateId) => {
                        const state = states.find((s) => s.id === stateId);
                        return state ? (
                          <Badge
                            key={stateId}
                            variant="outline"
                            className="text-xs border-brand-primary text-brand-primary"
                          >
                            {state.name}
                          </Badge>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ScreenshotSidebar;
