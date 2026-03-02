import React from "react";
import { Upload, Download, Camera, Loader2, CheckCircle } from "lucide-react";
import { Screenshot } from "../../../types/Screenshot";
import { MonitorInfo } from "../types";
import {
  QontinuiHeader,
  QontinuiHeaderActions,
  UploadButton,
  CreateButton,
  GhostButton,
} from "../../qontinui";
import { MonitorMenu } from "./MonitorMenu";
import { ExportMenu } from "./ExportMenu";

interface ScreenshotToolbarProps {
  saveStatus: "idle" | "saved";
  selectedScreenshot: Screenshot | null;
  zoomMode: "fit" | "original";
  onZoomToggle: () => void;
  // Upload
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  // Capture
  isCapturing: boolean;
  showMonitorMenu: boolean;
  availableMonitors: MonitorInfo[];
  monitorMenuRef: React.RefObject<HTMLDivElement | null>;
  onOpenMonitorMenu: () => void;
  onCaptureFromScreen: (monitorIndex: number | null) => void;
  // Export
  screenshots: Screenshot[];
  showExportMenu: boolean;
  onToggleExportMenu: () => void;
  onExportJson: () => void;
  onExportPython: () => void;
  onExportAll: () => void;
}

export const ScreenshotToolbar: React.FC<ScreenshotToolbarProps> = ({
  saveStatus,
  selectedScreenshot,
  zoomMode,
  onZoomToggle,
  fileInputRef,
  onFileUpload,
  isCapturing,
  showMonitorMenu,
  availableMonitors,
  monitorMenuRef,
  onOpenMonitorMenu,
  onCaptureFromScreen,
  screenshots,
  showExportMenu,
  onToggleExportMenu,
  onExportJson,
  onExportPython,
  onExportAll,
}) => {
  return (
    <QontinuiHeader>
      <div className="flex items-center justify-between w-full">
        {/* Upload and Capture buttons */}
        <div className="flex items-center gap-2">
          {saveStatus === "saved" && (
            <div className="flex items-center gap-1 text-xs text-brand-success">
              <CheckCircle className="w-4 h-4" />
              <span>Saved</span>
            </div>
          )}
          <UploadButton onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-4 h-4" />
            Upload Screenshots
          </UploadButton>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={onFileUpload}
            className="hidden"
          />

          {/* Capture from Screen button */}
          <div className="relative" ref={monitorMenuRef}>
            <UploadButton onClick={onOpenMonitorMenu} disabled={isCapturing}>
              {isCapturing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              {isCapturing ? "Capturing..." : "Capture from Screen"}
            </UploadButton>

            {showMonitorMenu && (
              <MonitorMenu
                availableMonitors={availableMonitors}
                onCapture={onCaptureFromScreen}
              />
            )}
          </div>
        </div>

        {/* Zoom controls */}
        <div className="flex-1 flex items-center justify-center gap-2">
          {selectedScreenshot && (
            <GhostButton onClick={onZoomToggle} size="sm">
              {zoomMode === "fit" ? "Original Size (1:1)" : "Fit to Screen"}
            </GhostButton>
          )}
        </div>

        {/* Export button */}
        <QontinuiHeaderActions>
          <div className="relative">
            <CreateButton
              onClick={onToggleExportMenu}
              disabled={screenshots.length === 0}
            >
              <Download className="w-4 h-4" />
              Export
            </CreateButton>

            {showExportMenu && (
              <ExportMenu
                onExportJson={onExportJson}
                onExportPython={onExportPython}
                onExportAll={onExportAll}
              />
            )}
          </div>
        </QontinuiHeaderActions>
      </div>
    </QontinuiHeader>
  );
};
