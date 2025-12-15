export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SemanticObject {
  id: string;
  description: string;
  ocr_text?: string | null;
  type: string;
  confidence: number;
  bounding_box: BoundingBox;
  pixel_mask?: string | null;
  attributes: {
    color?: number[];
    interactable?: boolean;
    position?: string;
    [key: string]: unknown;
  };
}

export interface SemanticScene {
  timestamp: string;
  object_count: number;
  objects: SemanticObject[];
}

export interface ProcessingOptions {
  enable_ocr: boolean;
  min_confidence: number;
  description_model: "clip" | "basic";
  focus_regions?: BoundingBox[];
}

export interface SemanticProcessRequest {
  image: string;
  strategy: "sam2" | "ocr" | "hybrid";
  options?: ProcessingOptions;
}

export interface SemanticProcessResponse {
  scene: SemanticScene;
  processing_time_ms: number;
}

export interface SemanticCompareRequest {
  image1: string;
  image2: string;
  comparison_type: "similarity" | "differences";
}

export interface ComparisonDifference {
  added: SemanticObject[];
  removed: SemanticObject[];
  changed: unknown[];
}

export interface SemanticCompareResponse {
  similarity_score: number;
  differences: ComparisonDifference;
}
