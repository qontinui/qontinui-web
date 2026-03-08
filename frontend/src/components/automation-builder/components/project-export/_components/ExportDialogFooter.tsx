import React from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Download, Loader2, Upload } from "lucide-react";
import type { RagStatus } from "../project-export-types";

interface ExportDialogFooterProps {
  ragStatus: RagStatus;
  isExporting: boolean;
  exportName: string;
  onClose: () => void;
  onExport: (loadToRunner: boolean) => void;
}

export function ExportDialogFooter({
  ragStatus,
  isExporting,
  exportName,
  onClose,
  onExport,
}: ExportDialogFooterProps) {
  const isProcessing = ragStatus === "processing" || ragStatus === "checking";
  const isDone =
    ragStatus === "completed" ||
    ragStatus === "failed" ||
    ragStatus === "skipped";

  return (
    <DialogFooter className="flex-col sm:flex-row gap-2">
      <Button
        variant="outline"
        onClick={onClose}
        className="border-border-default"
        disabled={isProcessing}
      >
        {isDone ? "Close" : "Cancel"}
      </Button>
      {ragStatus === "idle" && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onExport(false)}
            disabled={isExporting || !exportName.trim()}
            className="border-border-default hover:bg-surface-raised"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Export Only
              </>
            )}
          </Button>
          <Button
            onClick={() => onExport(true)}
            disabled={isExporting || !exportName.trim()}
            className="bg-brand-primary hover:bg-brand-primary/80 text-black"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Export & Load
              </>
            )}
          </Button>
        </div>
      )}
    </DialogFooter>
  );
}
