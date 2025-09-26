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
  stateId: string;
  name: string;
  type: 'StateRegion' | 'SearchRegion';
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  linkedStateObjectId?: string; // For SearchRegions linked to StateImages
  linkedStateObjectType?: 'StateImage'; // Type of linked object
}

export type AnchorType =
  | 'TOP_LEFT'
  | 'TOP_CENTER'
  | 'TOP_RIGHT'
  | 'MIDDLE_LEFT'
  | 'CENTER'
  | 'MIDDLE_RIGHT'
  | 'BOTTOM_LEFT'
  | 'BOTTOM_CENTER'
  | 'BOTTOM_RIGHT'
  | 'CUSTOM';

export interface ScreenshotLocation {
  id: string;
  screenshotId: string;
  stateId: string;
  name: string;
  x: number;
  y: number;
  anchor?: boolean; // If true, used as anchor point for region definition
  anchorType?: AnchorType; // Type of anchor when used as anchor
  fixed?: boolean; // If true, always use absolute coordinates
  clickTarget?: boolean; // If true, used as action target (click, type, hover)
  referenceImageId?: string; // ID of StateImage this location is relative to
  offsetX?: number; // X offset in pixels added to final position
  offsetY?: number; // Y offset in pixels added to final position
}

export type SelectionMode = 'view' | 'region' | 'location';

export interface ScreenshotCanvasState {
  scale: number;
  isDrawing: boolean;
  startPoint: { x: number; y: number } | null;
  currentRect: DOMRect | null;
  selectedRegion: ScreenshotRegion | null;
  selectedLocation: ScreenshotLocation | null;
}
