import { Region } from "@/types/pattern-optimization";
import type { MonitorInfo } from "@/components/common/ScreenshotPicker";

export type { DragHandle } from "@/components/common/_types/region-interaction";

export interface CompositeScreenshotDisplay {
  id: string;
  name: string;
  url: string;
  monitor: MonitorInfo;
}

export interface CompositeScreenshotCanvasProps {
  screenshots: CompositeScreenshotDisplay[];
  region?: Region;
  onRegionChange: (region: Region) => void;
  zoom?: number;
  panX?: number;
  panY?: number;
  onViewportChange?: (viewport: {
    zoom?: number;
    panX?: number;
    panY?: number;
  }) => void;
}

export interface LoadedImage {
  screenshot: CompositeScreenshotDisplay;
  image: HTMLImageElement;
}

export interface CompositeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}
