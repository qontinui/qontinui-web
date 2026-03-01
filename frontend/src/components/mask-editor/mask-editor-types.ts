export interface MaskEditorProps {
  imageUrl: string;
  imageName?: string;
  initialMask?: string; // Base64 encoded mask image (PNG with alpha channel)
  onSave: (maskedImage: string, mask: string) => void;
  onCancel: () => void;
  open?: boolean;
}

export type Tool = "brush" | "eraser";

export interface HistoryState {
  maskData: ImageData;
}

export interface CursorPosition {
  x: number;
  y: number;
  scale?: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface MaskBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
