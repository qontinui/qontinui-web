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

export interface ScreenshotLocation {
  id: string;
  screenshotId: string;
  stateId: string;
  name: string;
  x: number;
  y: number;
  anchor?: boolean; // If true, used as anchor point
  fixed?: boolean; // If true, location is fixed
  clickTarget?: boolean; // If true, used as click target
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
