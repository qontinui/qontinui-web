export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementAnnotation {
  id: string;
  name?: string | null;
  element_type: string;
  bbox: BoundingBox;
  text?: string | null;
  selector?: string | null;
  confidence?: number;
}

export interface StateAnnotation {
  id: string;
  name: string;
  bbox: BoundingBox;
  state_type: string;
  element_ids: string[];
}

export interface StateImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: StateAnnotation;
  elements: ElementAnnotation[];
  extractionId: string;
  screenshotId: string;
  viewportWidth: number;
  viewportHeight: number;
}

export type ViewMode = "state" | "element";
