/**
 * Template Capture Components
 *
 * Components for the click-to-template system:
 * - TemplateReviewPanel: Grid view of candidates with approve/reject
 * - BoundaryAdjustmentEditor: Interactive boundary adjustment
 * - ApplicationProfileManager: Profile CRUD and tuning
 * - ImportToStateMachineDialog: Import approved templates
 * - GenerateStateMachineDialog: Generate state machine from approved templates
 */

export { TemplateCandidateCard } from "./TemplateCandidateCard";
export type { TemplateCandidateCardProps } from "./TemplateCandidateCard";

export { TemplateReviewPanel } from "./TemplateReviewPanel";
export type { TemplateReviewPanelProps } from "./TemplateReviewPanel";

export { BoundaryAdjustmentEditor } from "./BoundaryAdjustmentEditor";
export type { BoundaryAdjustmentEditorProps } from "./BoundaryAdjustmentEditor";

export { ApplicationProfileManager } from "./ApplicationProfileManager";
export type { ApplicationProfileManagerProps } from "./ApplicationProfileManager";

export { ImportToStateMachineDialog } from "./ImportToStateMachineDialog";
export type { ImportToStateMachineDialogProps } from "./ImportToStateMachineDialog";

export { GenerateStateMachineDialog } from "./GenerateStateMachineDialog";
export type { GenerateStateMachineDialogProps } from "./GenerateStateMachineDialog";

export { SetStateHintDialog } from "./SetStateHintDialog";
export type { SetStateHintDialogProps } from "./SetStateHintDialog";

export { CaptureSessionPanel } from "./CaptureSessionPanel";
export type { CaptureSessionPanelProps } from "./CaptureSessionPanel";

// Re-export types from service for convenience
export type {
  TemplateCandidate,
  TemplateCandidateCreate,
  CandidateBoundingBox,
  ApplicationProfile,
  ApplicationProfileCreate,
  CandidateStatus,
  ElementType,
  DetectionStrategyType,
  TuningMetrics,
  TuningResult,
  GroupingMethod,
  GenerateStateMachineRequest,
  GenerateStateMachineResponse,
  ApprovedTemplateData,
} from "@/services/template-capture-service";
