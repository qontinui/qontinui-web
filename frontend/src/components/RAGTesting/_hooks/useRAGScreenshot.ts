import { useState, useCallback } from "react";
import type { ScreenshotInfo } from "@/components/common/ScreenshotPicker";
import { toast } from "sonner";

export function useRAGScreenshot(
  screenshots: { id: string; name: string; url?: string }[]
) {
  const [currentScreenshot, setCurrentScreenshot] =
    useState<ScreenshotInfo | null>(null);

  const handleUploadScreenshot = useCallback(
    (file: File, onReset: () => void) => {
      const url = URL.createObjectURL(file);
      setCurrentScreenshot({
        id: `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        url,
      });
      // Reset results when new screenshot is loaded
      onReset();
    },
    []
  );

  const handleSelectProjectScreenshot = useCallback(
    (screenshotId: string, onReset: () => void) => {
      const projectScreenshot = screenshots.find((s) => s.id === screenshotId);
      if (projectScreenshot && projectScreenshot.url) {
        setCurrentScreenshot({
          id: `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: projectScreenshot.name,
          url: projectScreenshot.url,
        });
        // Reset results when new screenshot is loaded
        onReset();
      } else {
        toast.error("Selected screenshot has no image URL");
      }
    },
    [screenshots]
  );

  const handleClearScreenshot = useCallback((onReset: () => void) => {
    setCurrentScreenshot(null);
    onReset();
  }, []);

  return {
    currentScreenshot,
    handleUploadScreenshot,
    handleSelectProjectScreenshot,
    handleClearScreenshot,
  };
}
