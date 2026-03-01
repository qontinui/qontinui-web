/**
 * Type definitions for StateExplorerView and its sub-components.
 */

import type {
  ExtractionAnnotation,
  StateMachineState,
  StateMachineStateImage,
  BoundingBox,
} from "@/types/extraction";

export interface StateExplorerViewProps {
  states: StateMachineState[];
  annotations: ExtractionAnnotation[];
  extractionId?: string;
}

export interface ImageWithBbox {
  stateImage: StateMachineStateImage;
  bbox: BoundingBox;
}

export interface StateImageThumbnailProps {
  stateImage: StateMachineStateImage;
  extractionId?: string;
  annotations: ExtractionAnnotation[];
  loadScreenshot: (screenshotId: string) => Promise<string | null>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  isSelected?: boolean;
}

export interface ScreenshotThumbnailProps {
  screenshotId: string;
  isSelected: boolean;
  screenshotCache: Map<string, string>;
  isLoading: boolean;
  onClick: () => void;
}
