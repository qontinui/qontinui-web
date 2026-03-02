import React from "react";

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

export interface CapturedScreenshot {
  id: string;
  name: string;
  url: string;
  file: File;
  monitor: MonitorInfo;
}

export interface ScreenshotPickerProps {
  currentScreenshot: ScreenshotInfo | null;
  onUploadScreenshot: (file: File) => void;
  onSelectProjectScreenshot: (screenshotId: string) => void;
  onClearScreenshot: () => void;
  showRegionInfo?: boolean;
  regionDimensions?: { width: number; height: number } | null;
  additionalInfo?: React.ReactNode;
  className?: string;
  enableCapture?: boolean;
  onCaptureMultipleScreenshots?: (screenshots: CapturedScreenshot[]) => void;
}
