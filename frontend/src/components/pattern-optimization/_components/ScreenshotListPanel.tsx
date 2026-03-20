"use client";

import React from "react";
import type { Screenshot } from "@/types/pattern-optimization";
import {
  Upload,
  X,
  Check,
  ImageIcon,
  MousePointer,
  FolderOpen,
} from "lucide-react";

interface ScreenshotListPanelProps {
  screenshots: Screenshot[];
  selectedScreenshotId: string | null;
  onSelectScreenshot: (id: string) => void;
  onRemoveScreenshot: (id: string) => void;
  onClearSession: () => void;
  onUploadClick: () => void;
  onProjectClick: () => void;
}

export const ScreenshotListPanel: React.FC<ScreenshotListPanelProps> = ({
  screenshots,
  selectedScreenshotId,
  onSelectScreenshot,
  onRemoveScreenshot,
  onClearSession,
  onUploadClick,
  onProjectClick,
}) => {
  return (
    <div className="w-64 bg-surface-raised/50 border-r border-border-subtle flex flex-col">
      <div className="p-4 border-b border-border-subtle">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-semibold text-white">Screenshots</h2>
          {screenshots.length > 0 && (
            <button
              onClick={onClearSession}
              className="px-3 py-1.5 bg-red-500/90 text-white rounded-md hover:bg-red-600 text-sm"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onUploadClick}
            className="flex-1 px-3 py-1.5 bg-brand-primary text-black rounded-md hover:bg-brand-primary/90 font-medium text-sm flex items-center justify-center gap-1"
            title="Upload new screenshots from your computer"
          >
            <Upload className="w-4 h-4" />
            Upload
          </button>
          <button
            onClick={onProjectClick}
            className="flex-1 px-3 py-1.5 bg-brand-success text-black rounded-md hover:bg-brand-success/90 font-medium text-sm flex items-center justify-center gap-1"
            title="Select screenshots from project"
          >
            <FolderOpen className="w-4 h-4" />
            Project
          </button>
        </div>
      </div>

      {/* Screenshot List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {screenshots.map((screenshot) => (
            <div
              key={screenshot.id}
              className={`p-3 border rounded-lg cursor-pointer transition-all ${
                selectedScreenshotId === screenshot.id
                  ? "border-brand-primary bg-brand-primary/10 shadow-sm"
                  : "border-border-default hover:bg-surface-raised/80"
              }`}
            >
              <div className="flex justify-between items-start">
                <div
                  role="button"
                  tabIndex={0}
                  className="flex-1"
                  onClick={() => {
                    onSelectScreenshot(screenshot.id);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectScreenshot(screenshot.id); } }}
                >
                  <div className="font-medium text-sm text-white truncate">
                    {screenshot.name}
                  </div>
                  {screenshot.region ? (
                    <div className="text-xs text-brand-success mt-1 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Region: {Math.round(screenshot.region.width)}x
                      {Math.round(screenshot.region.height)}
                    </div>
                  ) : (
                    <div className="text-xs text-text-muted mt-1 flex items-center gap-1">
                      <MousePointer className="w-3 h-3" />
                      Click to select region
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveScreenshot(screenshot.id);
                  }}
                  className="p-1 hover:bg-surface-raised rounded transition-colors"
                >
                  <X className="w-4 h-4 text-text-muted" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {screenshots.length === 0 && (
          <div className="text-center py-8">
            <ImageIcon className="w-12 h-12 mx-auto mb-2 text-text-muted" />
            <p className="text-sm text-text-muted">No screenshots uploaded</p>
            <p className="text-xs text-text-muted mt-1">
              Click &quot;Add&quot; to upload screenshots
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
