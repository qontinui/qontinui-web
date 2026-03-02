import React from "react";
import { Loader2, GitBranch } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { GenerateStateMachineResponse } from "@/services/template-capture-service";
import { useStateMachineGenerator } from "./_hooks/useStateMachineGenerator";
import { GenerationResultsView } from "./_components/GenerationResultsView";
import { GenerationConfigForm } from "./_components/GenerationConfigForm";
import { GenerationDialogFooter } from "./_components/GenerationDialogFooter";

export interface GenerateStateMachineDialogProps {
  projectId?: string;
  sessionId?: string;
  videoPath?: string;
  onGenerate?: (result: GenerateStateMachineResponse) => void;
  onClose: () => void;
}

export function GenerateStateMachineDialog({
  projectId,
  sessionId,
  videoPath,
  onGenerate,
  onClose,
}: GenerateStateMachineDialogProps) {
  const generator = useStateMachineGenerator({
    projectId,
    sessionId,
    videoPath,
    onGenerate,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Generate State Machine
          </DialogTitle>
          <DialogDescription>
            Create a state machine configuration from approved templates
          </DialogDescription>
        </DialogHeader>

        {generator.loadingTemplates ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : generator.result ? (
          <GenerationResultsView
            result={generator.result}
            importSuccess={generator.importSuccess}
            error={generator.error}
          />
        ) : (
          <GenerationConfigForm
            approvedTemplateCount={generator.approvedTemplates.length}
            uniqueStateHints={generator.uniqueStateHints}
            templatesByHint={generator.templatesByHint}
            groupingMethod={generator.groupingMethod}
            onGroupingMethodChange={generator.setGroupingMethod}
            stateMachineName={generator.stateMachineName}
            onStateMachineNameChange={generator.setStateMachineName}
            includeTransitions={generator.includeTransitions}
            onIncludeTransitionsChange={generator.setIncludeTransitions}
            showAdvanced={generator.showAdvanced}
            onShowAdvancedChange={generator.setShowAdvanced}
            coOccurrenceThreshold={generator.coOccurrenceThreshold}
            onCoOccurrenceThresholdChange={generator.setCoOccurrenceThreshold}
            sampleInterval={generator.sampleInterval}
            onSampleIntervalChange={generator.setSampleInterval}
            videoPath={videoPath}
            singleStateName={generator.singleStateName}
            onSingleStateNameChange={generator.setSingleStateName}
            error={generator.error}
          />
        )}

        <GenerationDialogFooter
          hasResult={!!generator.result}
          projectId={projectId}
          canGenerate={generator.canGenerate}
          generating={generator.generating}
          importing={generator.importing}
          importSuccess={generator.importSuccess}
          onClose={onClose}
          onGenerate={generator.handleGenerate}
          onDownload={generator.handleDownload}
          onImportToProject={generator.handleImportToProject}
        />
      </DialogContent>
    </Dialog>
  );
}
