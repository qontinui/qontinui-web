import { useState, useCallback } from "react";
import type { ScreenshotInfo } from "@/components/common/ScreenshotPicker";
import { toast } from "sonner";

export function useRAGScreenshot(
  screenshots: { id: string; name: string; url?: string }[]
) {
  const [currentScreenshot, setCurrentScreenshot] =
    useState<ScreenshotInfo | null>(null);

  const handleUploadScreenshot = useCallback(
    (
      file: File,
      resetResults: () => void
    ) => {
      const url = URL.createObjectURL(file);
      setCurrentScreenshot({
        id: `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        url,
      });
      resetResults();
    },
    []
  );

  const handleSelectProjectScreenshot = useCallback(
    (
      screenshotId: string,
      resetResults: () => void
    ) => {
      const projectScreenshot = screenshots.find((s) => s.id === screenshotId);
      if (projectScreenshot && projectScreenshot.url) {
        setCurrentScreenshot({
          id: `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: projectScreenshot.name,
          url: projectScreenshot.url,
        });
        resetResults();
      } else {
        toast.error("Selected screenshot has no image URL");
      }
    },
    [screenshots]
  );

  const handleClearScreenshot = useCallback(
    (resetResults: () => void) => {
      setCurrentScreenshot(null);
      resetResults();
    },
    []
  );

  return {
    currentScreenshot,
    setCurrentScreenshot,
    handleUploadScreenshot,
    handleSelectProjectScreenshot,
    handleClearScreenshot,
  };
}
