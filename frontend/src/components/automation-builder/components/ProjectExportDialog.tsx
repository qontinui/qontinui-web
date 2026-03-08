/**
 * ProjectExportDialog Component
 *
 * Exports the entire project configuration as a JSON file
 * that can be imported into qontinui-runner.
 *
 * After export, automatically sends the config to the runner for
 * RAG embedding generation if a runner is connected.
 */

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload } from "lucide-react";
import { useAutomation } from "@/contexts/automation-context";
import { MissingMonitorsDialog } from "@/components/export/MissingMonitorsDialog";
import { useProjectExport } from "./project-export/_hooks/useProjectExport";
import { ExportFormFields } from "./project-export/_components/ExportFormFields";
import { ExportSummary } from "./project-export/_components/ExportSummary";
import { ValidationWarnings } from "./project-export/_components/ValidationWarnings";
import { CleanupReport } from "./project-export/_components/CleanupReport";
import { RagProcessingStatus } from "./project-export/_components/RagProcessingStatus";
import { ConfigLoadingStatus } from "./project-export/_components/ConfigLoadingStatus";
import { ExportDialogFooter } from "./project-export/_components/ExportDialogFooter";

export interface ProjectExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectExportDialog({
  open,
  onOpenChange,
}: ProjectExportDialogProps) {
  const { workflows, states, transitions, images, screenshots, categories } =
    useAutomation();

  const {
    isExporting,
    isFixing,
    exportName,
    description,
    validationErrors,
    cleanupResult,
    monitorValidationErrors,
    showMonitorDialog,
    ragStatus,
    ragProgress,
    ragError,
    configLoaded,
    configLoadError,
    setExportName,
    setDescription,
    setShowMonitorDialog,
    handleExport,
    handleFixIssues,
    handleApplyMonitorUpdates,
  } = useProjectExport(open);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px] bg-surface-canvas border-border-subtle">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-brand-primary" />
              Export & Load to Runner
            </DialogTitle>
            <DialogDescription>
              Export the project configuration and load it into the
              qontinui-runner for automation execution.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <ExportFormFields
              exportName={exportName}
              description={description}
              onExportNameChange={setExportName}
              onDescriptionChange={setDescription}
            />

            <ExportSummary
              counts={{
                workflows: workflows.length,
                states: states.length,
                transitions: transitions.length,
                images: images.length,
                screenshots: screenshots.length,
                categories: categories.length,
              }}
            />

            <ValidationWarnings
              errors={validationErrors}
              isFixing={isFixing}
              onFixIssues={handleFixIssues}
            />

            {cleanupResult && <CleanupReport result={cleanupResult} />}

            <RagProcessingStatus
              ragStatus={ragStatus}
              ragProgress={ragProgress}
              ragError={ragError}
            />

            <ConfigLoadingStatus
              configLoaded={configLoaded}
              configLoadError={configLoadError}
            />
          </div>

          <ExportDialogFooter
            ragStatus={ragStatus}
            isExporting={isExporting}
            exportName={exportName}
            onClose={() => onOpenChange(false)}
            onExport={handleExport}
          />
        </DialogContent>
      </Dialog>

      <MissingMonitorsDialog
        open={showMonitorDialog}
        onOpenChange={setShowMonitorDialog}
        errors={monitorValidationErrors}
        onApply={handleApplyMonitorUpdates}
      />
    </>
  );
}
