import { useState } from "react";

export function useScreenshots() {
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [selectedScreenshotIndex, setSelectedScreenshotIndex] = useState(0);
  const [screenshotDimensions, setScreenshotDimensions] = useState({
    width: 800,
    height: 600,
  });

  return {
    screenshots,
    setScreenshots,
    selectedScreenshotIndex,
    setSelectedScreenshotIndex,
    screenshotDimensions,
    setScreenshotDimensions,
  };
}
