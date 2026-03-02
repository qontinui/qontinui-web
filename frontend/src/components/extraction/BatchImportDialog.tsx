"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, Files } from "lucide-react";
import { useBatchImport } from "./_hooks/useBatchImport";
import { BatchImportFormatSelect } from "./_components/BatchImportFormatSelect";
import { BatchImportFilePicker } from "./_components/BatchImportFilePicker";
import { BatchImportClassesFile } from "./_components/BatchImportClassesFile";
import { BatchImportOptions } from "./_components/BatchImportOptions";
import { BatchImportFileList } from "./_components/BatchImportFileList";
import { BatchImportSummary } from "./_components/BatchImportSummary";
import type { BatchImportDialogProps } from "./_hooks/batch-import-types";

export function BatchImportDialog({
  open,
  onOpenChange,
}: BatchImportDialogProps) {
  const state = useBatchImport(onOpenChange);

  return (
    <Dialog open={open} onOpenChange={state.handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Files className="h-5 w-5" />
            Batch Import Annotations
          </DialogTitle>
          <DialogDescription>
            Import multiple annotation files from a folder or file selection.
            Supports COCO JSON, YOLO txt, and CSV formats.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <BatchImportFormatSelect
            format={state.format}
            onFormatChange={state.setFormat}
            disabled={state.importing}
          />

          <BatchImportFilePicker
            importing={state.importing}
            hasFiles={state.files.length > 0}
            fileInputRef={state.fileInputRef}
            folderInputRef={state.folderInputRef}
            onFileSelect={state.handleFileSelect}
            onFolderSelect={state.handleFolderSelect}
          />

          {state.format === "yolo" && (
            <BatchImportClassesFile
              importing={state.importing}
              classesContent={state.classesContent}
              classesInputRef={state.classesInputRef}
              onClassesFileSelect={state.handleClassesFileSelect}
            />
          )}

          <BatchImportOptions
            skipDuplicates={state.skipDuplicates}
            onSkipDuplicatesChange={state.setSkipDuplicates}
            mergeOverlapping={state.mergeOverlapping}
            onMergeOverlappingChange={state.setMergeOverlapping}
            disabled={state.importing}
          />

          <BatchImportFileList
            files={state.files}
            results={state.results}
            importing={state.importing}
            completedCount={state.completedCount}
            errorCount={state.errorCount}
            progress={state.progress}
            onRemoveFile={state.removeFile}
            onClearAll={state.clearAllFiles}
          />

          <BatchImportSummary
            results={state.results}
            importing={state.importing}
            completedCount={state.completedCount}
            errorCount={state.errorCount}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={state.handleClose}
            disabled={state.importing}
          >
            {state.results.length > 0 && !state.importing ? "Close" : "Cancel"}
          </Button>
          <Button
            onClick={state.handleImport}
            disabled={state.files.length === 0 || state.importing}
            className="bg-[#9B59B6] hover:bg-[#9B59B6]/90"
          >
            {state.importing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Import {state.files.length} File
                {state.files.length !== 1 ? "s" : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
