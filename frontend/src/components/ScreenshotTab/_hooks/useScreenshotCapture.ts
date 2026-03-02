import { useState, useEffect, useRef } from "react";
import { type UploadingImage } from "@/components/ImageUploadProgress";
import { Screenshot } from "../../../types/Screenshot";
import { MonitorInfo } from "../types";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";

interface UseScreenshotCaptureOptions {
  projectId: string | null;
  projectName: string;
  addScreenshot: (screenshot: {
    id: string;
    name: string;
    url: string;
    size: number;
    uploadedAt: Date;
    projectName: string;
  }) => void;
  setSelectedScreenshot: (s: Screenshot | null) => void;
  setUploadingFiles: React.Dispatch<React.SetStateAction<UploadingImage[]>>;
  handleAutoSave: () => void;
}

export function useScreenshotCapture({
  projectId,
  projectName,
  addScreenshot,
  setSelectedScreenshot,
  setUploadingFiles,
  handleAutoSave,
}: UseScreenshotCaptureOptions) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [showMonitorMenu, setShowMonitorMenu] = useState(false);
  const [availableMonitors, setAvailableMonitors] = useState<MonitorInfo[]>([]);
  const monitorMenuRef = useRef<HTMLDivElement>(null);

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

  const handleOpenMonitorMenu = async () => {
    setShowMonitorMenu(true);
    try {
      const apiUrl =
        process.env.NEXT_PUBLIC_RUNNER_URL || "http://127.0.0.1:9876";
      const response = await fetch(`${apiUrl}/api/capture/screenshot/monitors`);
      if (response.ok) {
        const data = await response.json();
        setAvailableMonitors(data.monitors || []);
      }
    } catch (error) {
      console.error("Failed to fetch monitors:", error);
      setAvailableMonitors([
        { index: 0, width: 1920, height: 1080, is_primary: true },
      ]);
    }
  };

  const handleCaptureFromScreen = async (monitorIndex: number | null) => {
    setShowMonitorMenu(false);

    if (!projectId) {
      toast.error("No project selected", {
        description: "Please open a project before capturing screenshots.",
      });
      return;
    }

    setIsCapturing(true);
    try {
      const apiUrl =
        process.env.NEXT_PUBLIC_RUNNER_URL || "http://127.0.0.1:9876";
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

      const byteCharacters = atob(data.screenshot_base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "image/png" });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const monitorLabel =
        monitorIndex !== null ? `monitor${monitorIndex}_` : "";
      const filename = `screenshot_${monitorLabel}${timestamp}.png`;
      const file = new File([blob], filename, { type: "image/png" });

      setUploadingFiles([{ name: filename, progress: 0 }]);

      const result = await apiClient.uploadProjectScreenshot(
        parseInt(projectId ?? "0", 10),
        file,
        `Screenshot ${data.width}x${data.height}`,
        "web_capture",
        monitorIndex !== null ? monitorIndex : undefined,
        (progress) => {
          setUploadingFiles([{ name: filename, progress }]);
        }
      );

      const captureUrl = result.presigned_url;
      if (!captureUrl) {
        console.error("Upload response missing URL:", result);
        throw new Error("Upload succeeded but no URL was returned");
      }
      const screenshot = {
        id: result.id,
        name: result.name,
        url: captureUrl,
        size: result.file_size,
        uploadedAt: new Date(result.created_at),
        projectName: projectName,
      };

      addScreenshot(screenshot);

      handleAutoSave();

      const img = new window.Image();
      img.onload = () => {
        setSelectedScreenshot({
          id: screenshot.id,
          name: screenshot.name,
          imageData: screenshot.url,
          width: img.width,
          height: img.height,
          uploadedAt: screenshot.uploadedAt,
          associatedStates: [],
          regions: [],
          locations: [],
        });
      };
      img.src = screenshot.url;

      toast.success("Screenshot captured and uploaded", {
        description: `${data.width}x${data.height} pixels`,
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
      setUploadingFiles([]);
    }
  };

  return {
    isCapturing,
    showMonitorMenu,
    availableMonitors,
    monitorMenuRef,
    handleOpenMonitorMenu,
    handleCaptureFromScreen,
  };
}
