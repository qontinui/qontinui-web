import React, { useRef, useState, useEffect } from "react";
import {
  Upload,
  X,
  FolderOpen,
  ImageIcon,
  Camera,
  Loader2,
} from "lucide-react";
import { ScreenshotSelector } from "@/components/screenshot-selector";
import { toast } from "sonner";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";
import { MonitorSelector } from "@/components/monitor-selector";

export interface ScreenshotInfo {
  id: string;
  name: string;
  url: string;
}

export interface MonitorInfo {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  is_primary: boolean;
}

/** Screenshot captured with monitor position data for composite views */
export interface CapturedScreenshot {
  id: string;
  name: string;
  url: string;
  file: File;
  monitor: MonitorInfo;
}

// Delay options in seconds
const DELAY_OPTIONS = [0, 3, 5, 10];

// localStorage keys for screenshot capture preferences
const STORAGE_KEY_MONITORS = "qontinui-screenshot-monitors";
const STORAGE_KEY_DELAY = "qontinui-screenshot-delay";

/**
 * Load saved monitor preferences from localStorage
 */
function loadMonitorPrefs(): { monitors: number[]; delay: number } {
  if (typeof window === "undefined") {
    return { monitors: [], delay: 0 };
  }
  try {
    const monitorsStr = localStorage.getItem(STORAGE_KEY_MONITORS);
    const delayStr = localStorage.getItem(STORAGE_KEY_DELAY);
    return {
      monitors: monitorsStr ? JSON.parse(monitorsStr) : [],
      delay: delayStr ? parseInt(delayStr, 10) : 0,
    };
  } catch {
    return { monitors: [], delay: 0 };
  }
}

/**
 * Save monitor preferences to localStorage
 */
function saveMonitorPrefs(monitors: number[], delay: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_MONITORS, JSON.stringify(monitors));
    localStorage.setItem(STORAGE_KEY_DELAY, String(delay));
  } catch {
    // Ignore storage errors
  }
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
  /** Enable capture from screen functionality (requires runner running) */
  enableCapture?: boolean;
  /**
   * Callback for multi-monitor captures with position data.
   * If provided, this is called instead of onUploadScreenshot when capturing from screen.
   * All captured screenshots are passed at once with their monitor positions.
   */
  onCaptureMultipleScreenshots?: (screenshots: CapturedScreenshot[]) => void;
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
  onCaptureMultipleScreenshots,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotSelectorTriggerRef = useRef<HTMLButtonElement>(null);
  const monitorMenuRef = useRef<HTMLDivElement>(null);
  const captureButtonRef = useRef<HTMLButtonElement>(null);

  const [isCapturing, setIsCapturing] = useState(false);
  const [showMonitorMenu, setShowMonitorMenu] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Use runner monitors hook to get monitor configuration from runner (port 9876)
  const { monitors: runnerMonitors, isRunnerConnected } = useRunnerMonitors();

  // Convert runner monitors to component's MonitorInfo format
  const availableMonitors: MonitorInfo[] = runnerMonitors.map((m) => ({
    index: m.index,
    x: m.x,
    y: m.y,
    width: m.width,
    height: m.height,
    is_primary: m.is_primary,
  }));

  // Load saved preferences from localStorage
  const savedPrefs = loadMonitorPrefs();
  const [selectedMonitors, setSelectedMonitorsState] = useState<number[]>(
    savedPrefs.monitors
  );
  const [captureDelay, setCaptureDelayState] = useState<number>(
    savedPrefs.delay
  );

  // Wrapper to save monitor selection to localStorage
  const setSelectedMonitors = (
    value: number[] | ((prev: number[]) => number[])
  ) => {
    setSelectedMonitorsState((prev) => {
      const newValue = typeof value === "function" ? value(prev) : value;
      saveMonitorPrefs(newValue, captureDelay);
      return newValue;
    });
  };

  // Wrapper to save delay to localStorage
  const setCaptureDelay = (value: number) => {
    setCaptureDelayState(value);
    saveMonitorPrefs(selectedMonitors, value);
  };
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // Close monitor menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideMenu = monitorMenuRef.current?.contains(target);
      const isInsideButton = captureButtonRef.current?.contains(target);

      if (!isInsideMenu && !isInsideButton) {
        setShowMonitorMenu(false);
        setMenuPosition(null);
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

  const handleOpenMonitorMenu = () => {
    // Calculate position for fixed dropdown
    if (captureButtonRef.current) {
      const rect = captureButtonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 8, // 8px gap below button
        left: rect.left,
      });
    }
    setShowMonitorMenu(true);
  };

  // Handler for MonitorSelector changes - saves to localStorage
  const handleMonitorSelectionChange = (newSelection: number[]) => {
    // Ensure at least one monitor is selected
    if (newSelection.length === 0 && runnerMonitors.length > 0) {
      const primaryMonitor = runnerMonitors.find((m) => m.is_primary);
      const firstMonitor = runnerMonitors[0];
      if (primaryMonitor) {
        setSelectedMonitors([primaryMonitor.index]);
      } else if (firstMonitor) {
        setSelectedMonitors([firstMonitor.index]);
      }
    } else {
      setSelectedMonitors(newSelection);
    }
  };

  const handleCaptureFromScreen = async () => {
    if (selectedMonitors.length === 0) {
      toast.error("No monitors selected");
      return;
    }

    setShowMonitorMenu(false);
    setMenuPosition(null);
    setIsCapturing(true);

    try {
      // Apply delay if set
      if (captureDelay > 0) {
        setCountdown(captureDelay);
        for (let i = captureDelay; i > 0; i--) {
          setCountdown(i);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        setCountdown(null);
      }

      // Capture from all selected monitors using runner directly
      const apiUrl =
        process.env.NEXT_PUBLIC_RUNNER_URL || "http://localhost:9876";

      console.log(
        "[ScreenshotPicker] Starting capture for monitors:",
        selectedMonitors
      );

      // Collect all captured screenshots with their monitor data
      const capturedScreenshots: CapturedScreenshot[] = [];

      for (const monitorIndex of selectedMonitors) {
        console.log("[ScreenshotPicker] Capturing monitor:", monitorIndex);

        const response = await fetch(
          `${apiUrl}/api/capture/screenshot/current?monitor=${monitorIndex}&quality=95`
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            errorText ||
              `Failed to capture screenshot from monitor ${monitorIndex}`
          );
        }

        const data = await response.json();

        if (!data.screenshot_base64) {
          throw new Error(
            `No screenshot data returned for monitor ${monitorIndex}`
          );
        }

        console.log(
          "[ScreenshotPicker] Received screenshot data for monitor:",
          monitorIndex,
          {
            width: data.width,
            height: data.height,
          }
        );

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
        const monitorLabel = `monitor${monitorIndex}_`;
        const filename = `screenshot_${monitorLabel}${timestamp}.png`;
        const file = new File([blob], filename, { type: "image/png" });
        const url = URL.createObjectURL(blob);

        // Find monitor info from availableMonitors
        const monitorInfo = availableMonitors.find(
          (m) => m.index === monitorIndex
        );
        if (!monitorInfo) {
          console.warn(
            "[ScreenshotPicker] Monitor info not found for index:",
            monitorIndex
          );
          continue;
        }

        // Add to captured screenshots array
        capturedScreenshots.push({
          id: `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: filename,
          url,
          file,
          monitor: monitorInfo,
        });

        toast.success("Screenshot captured", {
          description: `Monitor ${monitorIndex}: ${data.width}x${data.height} pixels`,
        });
      }

      console.log(
        "[ScreenshotPicker] Capture loop completed, total monitors:",
        capturedScreenshots.length
      );

      // Call the appropriate callback
      if (onCaptureMultipleScreenshots && capturedScreenshots.length > 0) {
        // New callback: pass all screenshots with monitor positions
        console.log(
          "[ScreenshotPicker] Calling onCaptureMultipleScreenshots with:",
          capturedScreenshots.length,
          "screenshots"
        );
        onCaptureMultipleScreenshots(capturedScreenshots);
      } else {
        // Fallback: call onUploadScreenshot for each (backward compatible)
        for (const captured of capturedScreenshots) {
          console.log(
            "[ScreenshotPicker] Calling onUploadScreenshot for:",
            captured.name
          );
          onUploadScreenshot(captured.file);
        }
      }
    } catch (error: unknown) {
      console.error("Screenshot capture failed:", error);
      toast.error("Failed to capture screenshot", {
        description:
          (error as Error).message ||
          "Make sure runner is running on port 9876",
      });
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className={className}>
      {/* Screenshot Selection Buttons */}
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

          {/* Capture from Screen button */}
          {enableCapture && (
            <div className="relative">
              <button
                ref={captureButtonRef}
                onClick={handleOpenMonitorMenu}
                disabled={isCapturing}
                className="w-full px-3 py-2 bg-brand-secondary text-white rounded-md hover:bg-brand-secondary/90 text-sm flex items-center justify-center gap-2 font-medium disabled:opacity-50"
              >
                {isCapturing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {countdown !== null
                      ? `Capturing in ${countdown}s...`
                      : "Capturing..."}
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4" />
                    Capture Screen
                  </>
                )}
              </button>

              {showMonitorMenu && menuPosition && (
                <div
                  ref={monitorMenuRef}
                  className="fixed bg-surface-raised rounded-lg shadow-lg z-50 border border-border-default p-3"
                  style={{ top: menuPosition.top, left: menuPosition.left }}
                >
                  {/* Delay buttons */}
                  <div className="mb-3">
                    <label className="text-xs text-text-muted block mb-2">
                      Capture Delay
                    </label>
                    <div className="flex gap-1">
                      {DELAY_OPTIONS.map((delay) => (
                        <button
                          key={delay}
                          onClick={() => setCaptureDelay(delay)}
                          className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                            captureDelay === delay
                              ? "bg-brand-secondary text-white"
                              : "bg-surface-raised text-text-secondary hover:bg-surface-raised/80"
                          }`}
                        >
                          {delay}s
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Monitor selection - using shared MonitorSelector component */}
                  <div className="mb-3">
                    <MonitorSelector
                      monitors={selectedMonitors}
                      onChange={handleMonitorSelectionChange}
                      runnerMonitors={runnerMonitors}
                      isRunnerConnected={isRunnerConnected}
                      label="Select Monitors"
                      showLabel={true}
                      showConnectionStatus={true}
                    />
                  </div>

                  {/* Capture button */}
                  <button
                    onClick={handleCaptureFromScreen}
                    disabled={selectedMonitors.length === 0}
                    className="w-full px-3 py-2 bg-brand-secondary text-white rounded-md hover:bg-brand-secondary/90 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Camera className="w-4 h-4" />
                    Capture{" "}
                    {selectedMonitors.length > 1
                      ? `${selectedMonitors.length} Monitors`
                      : "Screen"}
                    {captureDelay > 0 && ` (${captureDelay}s delay)`}
                  </button>
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
            <div className="p-3 border border-brand-primary bg-brand-primary/10 rounded-lg">
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
                  className="ml-2 p-1 hover:bg-brand-primary/20 rounded transition-colors flex-shrink-0"
                  title="Clear screenshot"
                >
                  <X className="w-4 h-4 text-text-muted" />
                </button>
              </div>
              {showRegionInfo && regionDimensions ? (
                <div className="text-xs text-brand-success mt-1">
                  Region: {Math.round(regionDimensions.width)}×
                  {Math.round(regionDimensions.height)}
                </div>
              ) : showRegionInfo ? (
                <div className="text-xs text-text-muted mt-1">
                  Select a region on the image
                </div>
              ) : null}
            </div>

            {additionalInfo}
          </div>
        ) : (
          <div className="text-center py-8">
            <ImageIcon className="w-12 h-12 mx-auto mb-2 text-text-muted/50" />
            <p className="text-sm text-text-muted">No screenshot loaded</p>
            <p className="text-xs text-text-muted/80 mt-1">
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
