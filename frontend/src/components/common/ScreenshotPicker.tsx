import React, { useRef } from "react";
import { Upload, FolderOpen, Camera, Loader2 } from "lucide-react";
import { ScreenshotSelector } from "@/components/screenshot-selector";
import { useScreenshotCapture } from "./_hooks/useScreenshotCapture";
import { CaptureMenu } from "./_components/CaptureMenu";
import { ScreenshotInfoDisplay } from "./_components/ScreenshotInfoDisplay";

export type {
  ScreenshotInfo,
  MonitorInfo,
  CapturedScreenshot,
  ScreenshotPickerProps,
} from "./_types/screenshot-picker";

import type { ScreenshotPickerProps } from "./_types/screenshot-picker";

export const ScreenshotPicker: React.FC<ScreenshotPickerProps> = ({
  currentScreenshot,
  onUploadScreenshot,
  onSelectProjectScreenshot,
  onClearScreenshot,
  showRegionInfo = false,
  regionDimensions,
  additionalInfo,
  className = "",
  enableCapture = true,
  onCaptureMultipleScreenshots,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotSelectorTriggerRef = useRef<HTMLButtonElement>(null);

  const capture = useScreenshotCapture({
    onUploadScreenshot,
    onCaptureMultipleScreenshots,
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && files[0]) {
      onUploadScreenshot(files[0]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className={className}>
      <div className="p-4 border-b border-border-subtle">
        <h2 className="font-semibold text-white mb-3">Screenshot</h2>
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

          {enableCapture && (
            <div className="relative">
              <button
                ref={capture.captureButtonRef}
                onClick={capture.handleOpenMonitorMenu}
                disabled={capture.isCapturing}
                className="w-full px-3 py-2 bg-brand-secondary text-white rounded-md hover:bg-brand-secondary/90 text-sm flex items-center justify-center gap-2 font-medium disabled:opacity-50"
              >
                {capture.isCapturing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {capture.countdown !== null
                      ? `Capturing in ${capture.countdown}s...`
                      : "Capturing..."}
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4" />
                    Capture Screen
                  </>
                )}
              </button>

              {capture.showMonitorMenu && capture.menuPosition && (
                <CaptureMenu
                  menuRef={capture.monitorMenuRef}
                  menuPosition={capture.menuPosition}
                  captureDelay={capture.captureDelay}
                  onDelayChange={capture.setCaptureDelay}
                  selectedMonitors={capture.selectedMonitors}
                  onMonitorSelectionChange={
                    capture.handleMonitorSelectionChange
                  }
                  runnerMonitors={capture.runnerMonitors}
                  isRunnerConnected={capture.isRunnerConnected}
                  onCapture={capture.handleCaptureFromScreen}
                />
              )}
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      <div className="p-4">
        <ScreenshotInfoDisplay
          currentScreenshot={currentScreenshot}
          onClearScreenshot={onClearScreenshot}
          showRegionInfo={showRegionInfo}
          regionDimensions={regionDimensions}
          additionalInfo={additionalInfo}
        />
      </div>

      <ScreenshotSelector
        selectedScreenshot={currentScreenshot?.id || ""}
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
  );
};
