import type { Workflow } from "../../lib/action-schema/action-types";

export interface AIGenerationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAccept: (workflow: Workflow) => void;
  existingWorkflow?: Workflow;
  initialPrompt?: string;
}

export type GenerationState =
  | "idle"
  | "generating"
  | "success"
  | "error"
  | "refining";
