/**
 * Training Data Export Dialog
 *
 * Dialog for exporting annotated elements as training data in various formats.
 * Supports multiple export destinations:
 * - Local download (browser)
 * - S3 bucket (requires backend)
 * - Local filesystem path (requires backend)
 */

"use client";

import { Download, Cloud, HardDrive } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { useTrainingDataExport } from "./_hooks/useTrainingDataExport";
import type { TrainingDataExportDialogProps } from "./_hooks/training-data-export-types";
import { ElementCountsSummary } from "./_components/ElementCountsSummary";
import { FormatSelector } from "./_components/FormatSelector";
import { DestinationSelector } from "./_components/DestinationSelector";
import { ExportPreview } from "./_components/ExportPreview";

export function TrainingDataExportDialog({
  trigger,
  projectName,
}: TrainingDataExportDialogProps) {
  const {
    open,
    setOpen,
    format,
    setFormat,
    includeAllElements,
    setIncludeAllElements,
    destination,
    setDestination,
    s3Config,
    setS3Config,
    localPathConfig,
    setLocalPathConfig,
    isExporting,
    handleExport,
    canExport,
    groundTruthCount,
    totalCount,
  } = useTrainingDataExport({ projectName });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            variant="outline"
            size="sm"
            className="border-[#9B59B6]/50 text-[#9B59B6] hover:bg-[#9B59B6]/10"
          >
            <Download className="h-4 w-4 mr-2" />
            Export Training Data
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Export Training Data</DialogTitle>
          <DialogDescription>
            Export annotated elements for ML training. Ground truth elements are
            recommended for training.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <ElementCountsSummary
            totalCount={totalCount}
            groundTruthCount={groundTruthCount}
            includeAllElements={includeAllElements}
          />

          <FormatSelector format={format} onFormatChange={setFormat} />

          <DestinationSelector
            destination={destination}
            onDestinationChange={setDestination}
            s3Config={s3Config}
            onS3ConfigChange={setS3Config}
            localPathConfig={localPathConfig}
            onLocalPathConfigChange={setLocalPathConfig}
          />

          {/* Include all toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">
                Include All Elements
              </Label>
              <p className="text-xs text-text-muted">
                Export all {totalCount} elements, not just ground truth
              </p>
            </div>
            <Switch
              checked={includeAllElements}
              onCheckedChange={setIncludeAllElements}
            />
          </div>

          <ExportPreview
            format={format}
            destination={destination}
            includeAllElements={includeAllElements}
            totalCount={totalCount}
            groundTruthCount={groundTruthCount}
            s3Config={s3Config}
            localPathConfig={localPathConfig}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={!canExport}
            className="bg-[#9B59B6] hover:bg-[#9B59B6]/90"
          >
            {destination === "download" && (
              <Download className="h-4 w-4 mr-2" />
            )}
            {destination === "s3" && <Cloud className="h-4 w-4 mr-2" />}
            {destination === "local" && <HardDrive className="h-4 w-4 mr-2" />}
            {isExporting ? "Exporting..." : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
