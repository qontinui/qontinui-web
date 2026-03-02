import type { DiffRegion } from "@/services/testing-service";

export type ViewMode = "side-by-side" | "overlay" | "swipe" | "blink";

export interface VisualDiffViewerProps {
  baselineUrl: string | null;
  screenshotUrl: string | null;
  diffUrl?: string | null;
  diffRegions?: DiffRegion[];
  similarityScore?: number;
  threshold?: number;
  className?: string;
  initialMode?: ViewMode;
}
