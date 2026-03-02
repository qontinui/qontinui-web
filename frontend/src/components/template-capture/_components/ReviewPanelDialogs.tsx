import React from "react";
import { BoundaryAdjustmentEditor } from "../BoundaryAdjustmentEditor";
import { ImportToStateMachineDialog } from "../ImportToStateMachineDialog";
import { GenerateStateMachineDialog } from "../GenerateStateMachineDialog";
import { SetStateHintDialog } from "../SetStateHintDialog";
import type {
  TemplateCaptureService,
  TemplateCandidate,
  CandidateBoundingBox,
} from "@/services/template-capture-service";

interface ReviewPanelDialogsProps {
  service: TemplateCaptureService;
  editingCandidate: TemplateCandidate | null;
  onEditSave: (id: string, adjustedBoundary: CandidateBoundingBox) => void;
  onEditCancel: () => void;
  importingCandidate: TemplateCandidate | null;
  onImportComplete: (stateId: string) => void;
  onImportClose: () => void;
  showGenerateDialog: boolean;
  projectId?: string;
  sessionId?: string;
  videoPath?: string;
  onStateMachineGenerated: (result: unknown) => void;
  onGenerateClose: () => void;
  settingHintCandidates: TemplateCandidate[];
  uniqueStateHints: string[];
  onStateHintSaved: (hint: string) => void;
  onStateHintClose: () => void;
}

export function ReviewPanelDialogs({
  service,
  editingCandidate,
  onEditSave,
  onEditCancel,
  importingCandidate,
  onImportComplete,
  onImportClose,
  showGenerateDialog,
  projectId,
  sessionId,
  videoPath,
  onStateMachineGenerated,
  onGenerateClose,
  settingHintCandidates,
  uniqueStateHints,
  onStateHintSaved,
  onStateHintClose,
}: ReviewPanelDialogsProps) {
  return (
    <>
      {editingCandidate && (
        <BoundaryAdjustmentEditor
          candidate={editingCandidate}
          imageUrl={service.getImageUrl(editingCandidate)}
          onSave={(adjustedBoundary) => {
            onEditSave(editingCandidate.id, adjustedBoundary);
          }}
          onCancel={onEditCancel}
        />
      )}

      {importingCandidate && (
        <ImportToStateMachineDialog
          candidate={importingCandidate}
          onImport={onImportComplete}
          onClose={onImportClose}
        />
      )}

      {showGenerateDialog && (
        <GenerateStateMachineDialog
          projectId={projectId}
          sessionId={sessionId}
          videoPath={videoPath}
          onGenerate={onStateMachineGenerated}
          onClose={onGenerateClose}
        />
      )}

      {settingHintCandidates.length > 0 && (
        <SetStateHintDialog
          candidates={settingHintCandidates}
          existingHints={uniqueStateHints}
          onSave={onStateHintSaved}
          onClose={onStateHintClose}
        />
      )}
    </>
  );
}
