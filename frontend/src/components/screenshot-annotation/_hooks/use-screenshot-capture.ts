import { useState, useEffect, useRef } from "react";
import { useAutomation } from "../../../contexts/automation-context";
import { toast } from "sonner";
import { MonitorInfo } from "../screenshot-annotation-types";
import { Screenshot } from "../../../types/Screenshot";

export function useScreenshotCapture(
  screenshots: Screenshot[],
  setSelectedScreenshot: (screenshot: Screenshot | null) => void
) {
  const { addScreenshot } = useAutomation();

  // Screenshot upload/capture state
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

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const img = new window.Image();
      img.onload = () => {
        if (img.width < 10 || img.height < 10) {
          toast.error("Image too small", {
            description: `${file.name} is ${img.width}x${img.height}px. Images must be at least 10x10 pixels.`,
          });
          return;
        }

        const newScreenshot = {
          id: `screenshot-${Date.now()}`,
          name: file.name,
          url: base64,
          size: file.size,
          uploadedAt: new Date(),
        };

        addScreenshot(newScreenshot);
        toast.success("Screenshot uploaded successfully");
      };
      img.onerror = () => {
        toast.error("Failed to process image", {
          description: `${file.name} could not be loaded.`,
        });
      };
      img.src = base64;
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && files[0]) {
      handleFileUpload(files[0]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSelectProjectScreenshot = (screenshotId: string) => {
    const screenshot = screenshots.find((s) => s.id === screenshotId);
    if (screenshot) {
      setSelectedScreenshot(screenshot);
    }
  };

  const handleOpenMonitorMenu = async () => {
    setShowMonitorMenu(true);
    try {
      // Use the runner API for screenshot capture
      // Use 127.0.0.1 instead of localhost to force IPv4 (runner only listens on IPv4)
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
    setIsCapturing(true);

    try {
      // Use the runner API for screenshot capture
      // Use 127.0.0.1 instead of localhost to force IPv4 (runner only listens on IPv4)
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

      handleFileUpload(file);

      toast.success("Screenshot captured", {
        description: `${data.width}x${data.height} pixels`,
      });
    } catch (error: unknown) {
      console.error("Screenshot capture failed:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Make sure the runner is running on port 9876";
      toast.error("Failed to capture screenshot", {
        description: errorMessage,
      });
    } finally {
      setIsCapturing(false);
    }
  };

  return {
    fileInputRef,
    screenshotSelectorTriggerRef,
    monitorMenuRef,
    isCapturing,
    showMonitorMenu,
    availableMonitors,
    handleFileSelect,
    handleSelectProjectScreenshot,
    handleOpenMonitorMenu,
    handleCaptureFromScreen,
  };
}
