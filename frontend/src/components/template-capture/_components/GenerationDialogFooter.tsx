import React from "react";
import { Loader2, Wand2, Download, Check, Upload } from "lucide-react";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface GenerationDialogFooterProps {
  hasResult: boolean;
  projectId?: string;
  canGenerate: boolean;
  generating: boolean;
  importing: boolean;
  importSuccess: boolean;
  onClose: () => void;
  onGenerate: () => void;
  onDownload: () => void;
  onImportToProject: () => void;
}

export function GenerationDialogFooter({
  hasResult,
  projectId,
  canGenerate,
  generating,
  importing,
  importSuccess,
  onClose,
  onGenerate,
  onDownload,
  onImportToProject,
}: GenerationDialogFooterProps) {
  return (
    <DialogFooter>
      {hasResult ? (
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button variant="outline" onClick={onDownload}>
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
          {projectId && (
            <Button
              onClick={onImportToProject}
              disabled={importing || importSuccess}
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : importSuccess ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Imported
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Import to Project
                </>
              )}
            </Button>
          )}
        </>
      ) : (
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onGenerate} disabled={!canGenerate || generating}>
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                Generate
              </>
            )}
          </Button>
        </>
      )}
    </DialogFooter>
  );
}
