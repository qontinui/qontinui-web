import { Screenshot } from "../../types/Screenshot";
import { ActionSnapshot } from "../../lib/integration-testing-framework";

export interface ActionSnapshotBuilderProps {
  currentScreenshot: Screenshot;
  screenshots: Screenshot[];
  stateId: string;
  stateName: string;
  activeStates: string[];
  onSave: (snapshot: ActionSnapshot) => void;
  onCancel: () => void;
}

export interface Match {
  region: { x: number; y: number; width: number; height: number };
  score: number;
  stateImageId?: string;
}

export interface ActionConfigState {
  similarity: number;
  waitTime: number;
  mouseButton: string;
  offset: { x: number; y: number };
}
