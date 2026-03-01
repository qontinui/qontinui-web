import type { State, ImageAsset } from "@/contexts/automation-context/types";
import type { Monitor } from "@/lib/schemas/geometry";
import type {
  ImageRecognitionEvent,
  ConnectionState,
} from "@/hooks/useExecutionEvents";

export type CanvasMode = "perception" | "config";

export interface ActiveStatesCanvasProps {
  /** All states in the project (used to look up state info) */
  states: State[];
  /** All images in the project (used to load image assets) */
  images: ImageAsset[];
  /** Monitor info for multi-monitor coordinate handling */
  monitors?: Monitor[];
  /** Rendering mode: 'perception' for live execution, 'config' for static preview */
  mode?: CanvasMode;
  /** Currently active state IDs (for perception mode, required) */
  activeStateIds?: Set<string> | string[];
  /** Map of imageId to recognition events with found coordinates (perception mode) */
  foundImages?: Map<string, ImageRecognitionEvent>;
  /** Connection state for live mode indicator (perception mode) */
  connectionState?: ConnectionState;
  /** State ID to highlight (config mode only) */
  highlightStateId?: string;
  className?: string;
  /** Whether to show the monitor filter UI (default: true) */
  showMonitorFilter?: boolean;
}

export interface StateColor {
  border: string;
  bg: string;
  name: string;
}

export interface ActiveStateInfo {
  id: string;
  name: string;
  color: StateColor;
}

export interface VisibleFoundImage {
  imageId: string;
  recognition: ImageRecognitionEvent;
  stateId: string;
  stateName: string;
  imageLabel: string;
  color: StateColor;
}

export interface ConfigImage {
  imageId: string;
  stateId: string;
  stateName: string;
  imageLabel: string;
  color: StateColor;
  x: number;
  y: number;
  width?: number;
  height?: number;
  isHighlighted: boolean;
}

export interface StateBound {
  stateId: string;
  stateName: string;
  color: StateColor;
  x: number;
  y: number;
  width: number;
  height: number;
  isHighlighted: boolean;
}
