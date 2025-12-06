import React, { useRef, useState, useEffect } from "react";
import {
  Upload,
  X,
  FolderOpen,
  ImageIcon,
  Camera,
  Monitor,
  Loader2,
} from "lucide-react";
import { ScreenshotSelector } from "@/components/screenshot-selector";
import { toast } from "sonner";

export interface ScreenshotInfo {
  id: string;
  name: string;
  url: string;
}

interface MonitorInfo {
  index: number;
  width: number;
  height: number;
  is_primary: boolean;
}

interface ScreenshotPickerProps {
  currentScreenshot: ScreenshotInfo | null;
  onUploadScreenshot: (file: File) => void;
  onSelectProjectScreenshot: (screenshotId: string) => void;
  onClearScreenshot: () => void;
  showRegionInfo?: boolean;
  regionDimensions?: { width: number; height: number } | null;
  additionalInfo?: React.ReactNode;
  className?: string;
  /** Enable capture from screen functionality (requires qontinui-api running) */
  enableCapture?: boolean;
}

/**
 * Reusable screenshot selection component used across Image Extraction, Pattern Matching, and other pages.
 * Provides consistent UI for uploading screenshots or selecting from project screenshots.
 */
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
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotSelectorTriggerRef = useRef<HTMLButtonElement>(null);
  const monitorMenuRef = useRef<HTMLDivElement>(null);

  const [isCapturing, setIsCapturing] = useState(false);
  const [showMonitorMenu, setShowMonitorMenu] = useState(false);
  const [availableMonitors, setAvailableMonitors] = useState<MonitorInfo[]>([]);

  // Close monitor menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        monitorMenuRef.current &&
        !monitorMenuRef.current.contains(event.target as Node)
      ) {
        setShowMonitorMenu(false);
      }
    };

    if (showMonitorMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMonitorMenu]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && files[0]) {
      onUploadScreenshot(files[0]);
    }
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleOpenMonitorMenu = async () => {
    setShowMonitorMenu(true);
    try {
      const apiUrl =
        process.env.NEXT_PUBLIC_QONTINUI_API_URL || "http://localhost:8001";
      const response = await fetch(`${apiUrl}/api/capture/screenshot/monitors`);
      if (response.ok) {
        const data = await response.json();
        setAvailableMonitors(data.monitors || []);
      }
    } catch (error) {
      console.error("Failed to fetch monitors:", error);
      // Default to single monitor if API fails
      setAvailableMonitors([
        { index: 0, width: 1920, height: 1080, is_primary: true },
      ]);
    }
  };

  const handleCaptureFromScreen = async (monitorIndex: number | null) => {
    setShowMonitorMenu(false);
    setIsCapturing(true);

    try {
      const apiUrl =
        process.env.NEXT_PUBLIC_QONTINUI_API_URL || "http://localhost:8001";
      const monitorParam =
        monitorIndex !== null ? `&monitor=${monitorIndex}` : "";
      const response = await fetch(
        `${apiUrl}/api/capture/screenshot/current?quality=95${monitorParam}`
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          errorText || `Failed to capture screenshot: ${response.statusText}`
        );
      }

      const data = await response.json();

      // Convert base64 to Blob
      const byteCharacters = atob(data.screenshot_base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "image/png" });

      // Create File object from Blob
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const monitorLabel =
        monitorIndex !== null ? `monitor${monitorIndex}_` : "";
      const filename = `screenshot_${monitorLabel}${timestamp}.png`;
      const file = new File([blob], filename, { type: "image/png" });

      // Pass to upload handler
      onUploadScreenshot(file);

      toast.success("Screenshot captured", {
        description: `${data.width}x${data.height} pixels`,
      });
    } catch (error: any) {
      console.error("Screenshot capture failed:", error);
      toast.error("Failed to capture screenshot", {
        description:
          error.message || "Make sure qontinui-api is running on port 8001",
      });
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className={className}>
      {/* Screenshot Selection Buttons */}
      <div className="p-4 border-b border-gray-800">
        <h2 className="font-semibold text-white mb-3">Screenshot</h2>
        <div className="space-y-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-3 py-2 bg-[#00D9FF] text-black rounded-md hover:bg-[#00D9FF]/90 text-sm flex items-center justify-center gap-2 font-medium"
          >
            <Upload className="w-4 h-4" />
            Upload Image
          </button>
          <button
            onClick={() => screenshotSelectorTriggerRef.current?.click()}
            className="w-full px-3 py-2 bg-[#00FF88] text-black rounded-md hover:bg-[#00FF88]/90 text-sm flex items-center justify-center gap-2 font-medium"
          >
            <FolderOpen className="w-4 h-4" />
            From Project
          </button>

          {/* Capture from Screen button */}
          {enableCapture && (
            <div className="relative" ref={monitorMenuRef}>
              <button
                onClick={handleOpenMonitorMenu}
                disabled={isCapturing}
                className="w-full px-3 py-2 bg-[#BD00FF] text-white rounded-md hover:bg-[#BD00FF]/90 text-sm flex items-center justify-center gap-2 font-medium disabled:opacity-50"
              >
                {isCapturing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Camera className="w-4 h-4" />
                )}
                {isCapturing ? "Capturing..." : "Capture Screen"}
              </button>

              {showMonitorMenu && (
                <div className="absolute left-0 right-0 mt-2 bg-[#27272A] rounded-md shadow-lg z-10 border border-gray-700">
                  <div className="py-1">
                    <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-700">
                      Select monitor
                    </div>
                    {availableMonitors.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-400 flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading...
                      </div>
                    ) : (
                      <>
                        {availableMonitors.map((monitor) => (
                          <button
                            key={monitor.index}
                            onClick={() =>
                              handleCaptureFromScreen(monitor.index)
                            }
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
                          >
                            <Monitor className="w-4 h-4" />
                            <span className="flex-1">
                              Monitor {monitor.index + 1}
                              {monitor.is_primary && (
                                <span className="text-xs text-[#00FF88] ml-1">
                                  (Primary)
                                </span>
                              )}
                            </span>
                            <span className="text-xs text-gray-500">
                              {monitor.width}×{monitor.height}
                            </span>
                          </button>
                        ))}
                        {availableMonitors.length > 1 && (
                          <>
                            <div className="border-t border-gray-700 my-1"></div>
                            <button
                              onClick={() => handleCaptureFromScreen(null)}
                              className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
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

      {/* Current Screenshot Info */}
      <div className="p-4">
        {currentScreenshot ? (
          <div className="space-y-4">
            <div className="p-3 border border-[#00D9FF] bg-[#00D9FF]/10 rounded-lg">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1 min-w-0">
                  <div
                    className="font-medium text-sm text-white truncate"
                    title={currentScreenshot.name}
                  >
                    {currentScreenshot.name}
                  </div>
                </div>
                <button
                  onClick={onClearScreenshot}
                  className="ml-2 p-1 hover:bg-[#00D9FF]/20 rounded transition-colors flex-shrink-0"
                  title="Clear screenshot"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              {showRegionInfo && regionDimensions ? (
                <div className="text-xs text-[#00FF88] mt-1">
                  Region: {Math.round(regionDimensions.width)}×
                  {Math.round(regionDimensions.height)}
                </div>
              ) : showRegionInfo ? (
                <div className="text-xs text-gray-400 mt-1">
                  Select a region on the image
                </div>
              ) : null}
            </div>

            {additionalInfo}
          </div>
        ) : (
          <div className="text-center py-8">
            <ImageIcon className="w-12 h-12 mx-auto mb-2 text-gray-600" />
            <p className="text-sm text-gray-400">No screenshot loaded</p>
            <p className="text-xs text-gray-500 mt-1">
              Upload or select from project
            </p>
          </div>
        )}
      </div>

      {/* Hidden Screenshot Selector Trigger */}
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
