import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";
import type {
  MonitorInfo,
  CapturedScreenshot,
} from "../_types/screenshot-picker";

const STORAGE_KEY_MONITORS = "qontinui-screenshot-monitors";
const STORAGE_KEY_DELAY = "qontinui-screenshot-delay";

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

function saveMonitorPrefs(monitors: number[], delay: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_MONITORS, JSON.stringify(monitors));
    localStorage.setItem(STORAGE_KEY_DELAY, String(delay));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Capture a screenshot from a specific monitor via the runner API.
 * Returns `{ file, width, height }` on success.
 */
export async function captureScreenshotFromRunner(
  monitorIndex: number
): Promise<{ file: File; width: number; height: number }> {
  const apiUrl = process.env.NEXT_PUBLIC_RUNNER_URL || "http://127.0.0.1:9876";

  const response = await fetch(
    `${apiUrl}/api/capture/screenshot/current?monitor=${monitorIndex}&quality=95`
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      errorText || `Failed to capture screenshot from monitor ${monitorIndex}`
    );
  }

  const data = await response.json();

  if (!data.screenshot_base64) {
    throw new Error(`No screenshot data returned for monitor ${monitorIndex}`);
  }

  const byteCharacters = atob(data.screenshot_base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: "image/png" });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const monitorLabel = `monitor${monitorIndex}_`;
  const filename = `screenshot_${monitorLabel}${timestamp}.png`;
  const file = new File([blob], filename, { type: "image/png" });

  return { file, width: data.width, height: data.height };
}

export interface UseScreenshotCaptureOptions {
  onUploadScreenshot: (file: File) => void;
  onCaptureMultipleScreenshots?: (screenshots: CapturedScreenshot[]) => void;
}

export function useScreenshotCapture({
  onUploadScreenshot,
  onCaptureMultipleScreenshots,
}: UseScreenshotCaptureOptions) {
  const monitorMenuRef = useRef<HTMLDivElement>(null);
  const captureButtonRef = useRef<HTMLButtonElement>(null);

  const [isCapturing, setIsCapturing] = useState(false);
  const [showMonitorMenu, setShowMonitorMenu] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const { monitors: runnerMonitors, isRunnerConnected } = useRunnerMonitors();

  const availableMonitors: MonitorInfo[] = runnerMonitors.map((m) => ({
    index: m.index,
    x: m.x,
    y: m.y,
    width: m.width,
    height: m.height,
    is_primary: m.is_primary,
  }));

  const savedPrefs = loadMonitorPrefs();
  const [selectedMonitors, setSelectedMonitorsState] = useState<number[]>(
    savedPrefs.monitors
  );
  const [captureDelay, setCaptureDelayState] = useState<number>(
    savedPrefs.delay
  );

  const setSelectedMonitors = useCallback(
    (value: number[] | ((prev: number[]) => number[])) => {
      setSelectedMonitorsState((prev) => {
        const newValue = typeof value === "function" ? value(prev) : value;
        saveMonitorPrefs(newValue, captureDelay);
        return newValue;
      });
    },
    [captureDelay]
  );

  const setCaptureDelay = useCallback(
    (value: number) => {
      setCaptureDelayState(value);
      saveMonitorPrefs(selectedMonitors, value);
    },
    [selectedMonitors]
  );

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

  const handleOpenMonitorMenu = useCallback(() => {
    if (captureButtonRef.current) {
      const rect = captureButtonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 8,
        left: rect.left,
      });
    }
    setShowMonitorMenu(true);
  }, []);

  const handleMonitorSelectionChange = useCallback(
    (newSelection: number[]) => {
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
    },
    [runnerMonitors, setSelectedMonitors]
  );

  const handleCaptureFromScreen = useCallback(async () => {
    if (selectedMonitors.length === 0) {
      toast.error("No monitors selected");
      return;
    }

    setShowMonitorMenu(false);
    setMenuPosition(null);
    setIsCapturing(true);

    try {
      if (captureDelay > 0) {
        setCountdown(captureDelay);
        for (let i = captureDelay; i > 0; i--) {
          setCountdown(i);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        setCountdown(null);
      }

      const capturedScreenshots: CapturedScreenshot[] = [];

      for (const monitorIndex of selectedMonitors) {
        const { file, width, height } =
          await captureScreenshotFromRunner(monitorIndex);
        const url = URL.createObjectURL(file);

        const monitorInfo = availableMonitors.find(
          (m) => m.index === monitorIndex
        );
        if (!monitorInfo) {
          continue;
        }

        capturedScreenshots.push({
          id: `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          url,
          file,
          monitor: monitorInfo,
        });

        toast.success("Screenshot captured", {
          description: `Monitor ${monitorIndex}: ${width}x${height} pixels`,
        });
      }

      if (onCaptureMultipleScreenshots && capturedScreenshots.length > 0) {
        onCaptureMultipleScreenshots(capturedScreenshots);
      } else {
        for (const captured of capturedScreenshots) {
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
  }, [
    selectedMonitors,
    captureDelay,
    availableMonitors,
    onCaptureMultipleScreenshots,
    onUploadScreenshot,
  ]);

  /**
   * Capture a single monitor by index without delay/countdown.
   * Useful for simple UIs where the user clicks a specific monitor to capture.
   * Pass `null` to capture the primary monitor (first available).
   */
  const captureSingleMonitor = useCallback(
    async (monitorIndex: number | null) => {
      setIsCapturing(true);
      try {
        const targetIndex =
          monitorIndex ?? runnerMonitors.find((m) => m.is_primary)?.index ?? 0;

        const { file, width, height } =
          await captureScreenshotFromRunner(targetIndex);

        onUploadScreenshot(file);

        toast.success("Screenshot captured", {
          description: `${width}x${height} pixels`,
        });
      } catch (error: unknown) {
        console.error("Screenshot capture failed:", error);
        toast.error("Failed to capture screenshot", {
          description:
            error instanceof Error
              ? error.message
              : "Make sure the runner is running on port 9876",
        });
      } finally {
        setIsCapturing(false);
      }
    },
    [runnerMonitors, onUploadScreenshot]
  );

  return {
    monitorMenuRef,
    captureButtonRef,
    isCapturing,
    showMonitorMenu,
    countdown,
    menuPosition,
    selectedMonitors,
    captureDelay,
    setCaptureDelay,
    runnerMonitors,
    isRunnerConnected,
    handleOpenMonitorMenu,
    handleMonitorSelectionChange,
    handleCaptureFromScreen,
    captureSingleMonitor,
  };
}
