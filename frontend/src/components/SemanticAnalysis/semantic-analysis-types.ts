import type { SemanticObject, SemanticScene } from "@/types/semantic-analysis";

export interface Point {
  x: number;
  y: number;
}

export type DetectionStrategy = "sam2" | "sam3" | "ocr" | "hybrid";
export type DescriptionModel = "clip" | "basic";

export interface ProcessingOptionsState {
  confidence: number;
  setConfidence: (v: number) => void;
  enableOCR: boolean;
  setEnableOCR: (v: boolean) => void;
  descriptionModel: DescriptionModel;
  setDescriptionModel: (v: DescriptionModel) => void;
  strategy: DetectionStrategy;
  setStrategy: (v: DetectionStrategy) => void;
  textPrompt: string;
  setTextPrompt: (v: string) => void;
}

export interface DisplayOptionsState {
  showLabels: boolean;
  setShowLabels: (v: boolean) => void;
  showBoundingBoxes: boolean;
  setShowBoundingBoxes: (v: boolean) => void;
  showMasks: boolean;
  setShowMasks: (v: boolean) => void;
}

export interface CanvasViewportState {
  zoom: number;
  panOffset: Point;
  isDragging: boolean;
  dragStart: Point;
  setZoom: (v: number) => void;
  setPanOffset: (v: Point) => void;
  setIsDragging: (v: boolean) => void;
  setDragStart: (v: Point) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
}

export interface ImageAnalysisState {
  selectedImage: string | null;
  processing: boolean;
  scene: SemanticScene | null;
  selectedObject: SemanticObject | null;
  hoveredObject: string | null;
  setSelectedImage: (v: string | null) => void;
  setScene: (v: SemanticScene | null) => void;
  setSelectedObject: (v: SemanticObject | null) => void;
  setHoveredObject: (v: string | null) => void;
  handleImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  processImage: () => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}
