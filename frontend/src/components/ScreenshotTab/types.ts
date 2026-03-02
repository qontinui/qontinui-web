import { Screenshot } from "../../types/Screenshot";
import { type UploadingImage } from "@/components/ImageUploadProgress";

export interface ScreenshotUploadTabProps {
  states: State[];
  onExport: (screenshots: Screenshot[]) => void;
}

export interface MonitorInfo {
  index: number;
  width: number;
  height: number;
  is_primary: boolean;
}

// Re-export for convenience
export type { Screenshot, UploadingImage };

// Import State from automation context
import { State } from "../../contexts/automation-context/types";
export type { State };
