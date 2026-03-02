import { StateImage } from "../../types/stateDiscovery";

export interface MaskEditorProps {
  stateImage: StateImage;
  initialMask?: string; // Base64 encoded mask
  onSave?: (maskData: string) => void;
  onCancel?: () => void;
}

export type Tool = "brush" | "eraser" | "rectangle" | "circle";

export type EditAction = {
  type: "draw" | "erase";
  points: { x: number; y: number }[];
  tool: Tool;
  size: number;
};
