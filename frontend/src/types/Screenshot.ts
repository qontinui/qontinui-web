/**
 * Screenshot types for visual state configuration
 */

export interface Screenshot {
  id: string;
  name: string;
  imageData: string; // base64
  width: number;
  height: number;
  uploadedAt: Date;
  associatedStates: string[]; // state IDs
  regions: ScreenshotRegion[];
  locations: ScreenshotLocation[];
}

export interface ScreenshotRegion {
  id: string;
  screenshotId: string;
  stateId: string; // State to save this region to
  name: string;
  type: "StateRegion" | "SearchRegion";
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  linkedStateObjectId?: string; // For SearchRegions and StateRegions linked to StateImages
  linkedStateObjectType?: "StateImage"; // Type of linked object
  referenceStateId?: string; // State containing the reference image (for SearchRegions)
  saveToStateImageId?: string; // For SearchRegions: the StateImage to save this SearchRegion to
  saveToStateImageStateId?: string; // For SearchRegions: the state containing the StateImage to save to
}

export type AnchorType =
  | "TOP_LEFT"
  | "TOP_CENTER"
  | "TOP_RIGHT"
  | "MIDDLE_LEFT"
  | "CENTER"
  | "MIDDLE_RIGHT"
  | "BOTTOM_LEFT"
  | "BOTTOM_CENTER"
  | "BOTTOM_RIGHT"
  | "CUSTOM";

export interface ScreenshotLocation {
  id: string;
  screenshotId: string;
  stateId: string; // State to save this location to
  name: string;
  x: number;
  y: number;
  anchor?: boolean; // If true, used as anchor point for region definition
  anchorType?: AnchorType; // Type of anchor when used as anchor
  fixed?: boolean; // If true, always use absolute coordinates
  referenceImageId?: string; // ID of StateImage this location is relative to
  referenceStateId?: string; // State containing the reference image
  offsetX?: number; // X offset in pixels added to final position
  offsetY?: number; // Y offset in pixels added to final position
  percentW?: number; // Percent of width (0.0-1.0) for relative positioning
  percentH?: number; // Percent of height (0.0-1.0) for relative positioning
}

export type SelectionMode = "view" | "region" | "location";

export interface ScreenshotCanvasState {
  scale: number;
  isDrawing: boolean;
  startPoint: { x: number; y: number } | null;
  currentRect: DOMRect | null;
  selectedRegion: ScreenshotRegion | null;
  selectedLocation: ScreenshotLocation | null;
}
