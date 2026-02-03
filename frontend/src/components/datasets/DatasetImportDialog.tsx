"use client";

/**
 * Dataset Import Dialog
 *
 * Modal for importing training datasets from:
 * - ZIP files containing Training Data Exporter output
 * - Direct folder upload (manifest.jsonl + images/ + annotations/)
 */

import { useState, useRef } from "react";
import { datasetService } from "@/services/dataset-service";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Upload,
  FileArchive,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";

interface DatasetImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

type ImportStep =
  | "select"
  | "configure"
  | "uploading"
  | "processing"
  | "complete"
  | "error";

export function DatasetImportDialog({
  open,
  onOpenChange,
  onImportComplete,
}: DatasetImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<ImportStep>("select");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [description, setDescription] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [importResult, setImportResult] = useState<{
    images: number;
    annotations: number;
    warnings: string[];
    errors: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith(".zip")) {
      toast.error("Please select a ZIP file");
      return;
    }

    setSelectedFile(file);
    // Auto-generate name from filename
    const baseName = file.name.replace(".zip", "").replace(/_/g, " ");
    setDatasetName(baseName);
    setStep("configure");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();

    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (!file.name.endsWith(".zip")) {
      toast.error("Please drop a ZIP file");
      return;
    }

    setSelectedFile(file);
    const baseName = file.name.replace(".zip", "").replace(/_/g, " ");
    setDatasetName(baseName);
    setStep("configure");
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleImport = async () => {
    if (!selectedFile || !datasetName.trim()) {
      toast.error("Please provide a dataset name");
      return;
    }

    setStep("uploading");
    setUploadProgress(0);
    setError(null);

    try {
      const result = await datasetService.importDataset(
        selectedFile,
        datasetName.trim(),
        description.trim() || undefined,
        (progress) => {
          setUploadProgress(progress);
          if (progress === 100) {
            setStep("processing");
          }
        }
      );

      setImportResult({
        images: result.images_imported,
        annotations: result.annotations_imported,
        warnings: result.warnings,
        errors: result.errors,
      });

      if (result.errors.length > 0) {
        setStep("error");
      } else {
        setStep("complete");
      }
    } catch (err) {
      console.error("Import error:", err);
      setError(err instanceof Error ? err.message : "Import failed");
      setStep("error");
    }
  };

  const handleClose = () => {
    // Reset state
    setStep("select");
    setSelectedFile(null);
    setDatasetName("");
    setDescription("");
    setUploadProgress(0);
    setImportResult(null);
    setError(null);

    onOpenChange(false);

    // Notify parent if import was successful
    if (step === "complete") {
      onImportComplete();
    }
  };

  const handleReset = () => {
    setStep("select");
    setSelectedFile(null);
    setDatasetName("");
    setDescription("");
    setUploadProgress(0);
    setImportResult(null);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg" data-ui-id="dialog-dataset-import">
        <DialogHeader>
          <DialogTitle>Import Training Dataset</DialogTitle>
          <DialogDescription>
            Import a dataset exported from the Training Data Exporter. The ZIP
            file should contain manifest.jsonl, images/, and annotations/
            directories.
          </DialogDescription>
        </DialogHeader>

        {/* Step: Select File */}
        {step === "select" && (
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <FileArchive className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">
              Drop your dataset ZIP here
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              or click to browse
            </p>
            <Button variant="outline" size="sm">
              <Upload className="mr-2 h-4 w-4" />
              Select File
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleFileSelect}
              data-ui-id="dialog-dataset-import-file-input"
            />
          </div>
        )}

        {/* Step: Configure */}
        {step === "configure" && selectedFile && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-accent/50 rounded-lg">
              <FileArchive className="h-8 w-8 text-primary" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{selectedFile.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={handleReset}>
                Change
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dataset-name">Dataset Name *</Label>
              <Input
                id="dataset-name"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                placeholder="e.g., Login Flow Training Data"
                data-ui-id="dialog-dataset-import-name-input"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dataset-description">Description</Label>
              <Textarea
                id="dataset-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description of this dataset..."
                rows={3}
                data-ui-id="dialog-dataset-import-description-input"
              />
            </div>
          </div>
        )}

        {/* Step: Uploading */}
        {step === "uploading" && (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto h-12 w-12 text-primary animate-spin mb-4" />
            <p className="font-medium mb-4">Uploading dataset...</p>
            <Progress value={uploadProgress} className="w-full" />
            <p className="text-sm text-muted-foreground mt-2">
              {uploadProgress}%
            </p>
          </div>
        )}

        {/* Step: Processing */}
        {step === "processing" && (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto h-12 w-12 text-primary animate-spin mb-4" />
            <p className="font-medium">Processing dataset...</p>
            <p className="text-sm text-muted-foreground mt-2">
              Extracting images and annotations
            </p>
          </div>
        )}

        {/* Step: Complete */}
        {step === "complete" && importResult && (
          <div className="py-4">
            <div className="flex items-center justify-center mb-6">
              <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-center mb-4">
              Import Successful!
            </h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-center p-4 bg-accent/50 rounded-lg">
                <p className="text-3xl font-bold">{importResult.images}</p>
                <p className="text-sm text-muted-foreground">Images Imported</p>
              </div>
              <div className="text-center p-4 bg-accent/50 rounded-lg">
                <p className="text-3xl font-bold">{importResult.annotations}</p>
                <p className="text-sm text-muted-foreground">
                  Annotations Imported
                </p>
              </div>
            </div>
            {importResult.warnings.length > 0 && (
              <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                  Warnings ({importResult.warnings.length})
                </p>
                <ul className="text-xs text-yellow-700 dark:text-yellow-300 space-y-1">
                  {importResult.warnings.slice(0, 3).map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                  {importResult.warnings.length > 3 && (
                    <li>• ... and {importResult.warnings.length - 3} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Step: Error */}
        {step === "error" && (
          <div className="py-4">
            <div className="flex items-center justify-center mb-6">
              <div className="h-16 w-16 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-center mb-4">
              Import {importResult ? "Completed with Errors" : "Failed"}
            </h3>
            {error && (
              <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg mb-4">
                <p className="text-sm text-red-700 dark:text-red-300">
                  {error}
                </p>
              </div>
            )}
            {importResult && (
              <>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="text-center p-4 bg-accent/50 rounded-lg">
                    <p className="text-3xl font-bold">{importResult.images}</p>
                    <p className="text-sm text-muted-foreground">
                      Images Imported
                    </p>
                  </div>
                  <div className="text-center p-4 bg-accent/50 rounded-lg">
                    <p className="text-3xl font-bold">
                      {importResult.annotations}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Annotations Imported
                    </p>
                  </div>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg">
                    <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">
                      Errors ({importResult.errors.length})
                    </p>
                    <ul className="text-xs text-red-700 dark:text-red-300 space-y-1">
                      {importResult.errors.slice(0, 5).map((e, i) => (
                        <li key={i}>• {e}</li>
                      ))}
                      {importResult.errors.length > 5 && (
                        <li>• ... and {importResult.errors.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "select" && (
            <Button
              variant="outline"
              onClick={handleClose}
              data-ui-id="dialog-dataset-import-cancel-btn"
            >
              Cancel
            </Button>
          )}

          {step === "configure" && (
            <>
              <Button
                variant="outline"
                onClick={handleReset}
                data-ui-id="dialog-dataset-import-back-btn"
              >
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={!datasetName.trim()}
                data-ui-id="dialog-dataset-import-confirm-btn"
              >
                <Upload className="mr-2 h-4 w-4" />
                Import Dataset
              </Button>
            </>
          )}

          {(step === "uploading" || step === "processing") && (
            <Button variant="outline" disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </Button>
          )}

          {step === "complete" && (
            <Button
              onClick={handleClose}
              data-ui-id="dialog-dataset-import-done-btn"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Done
            </Button>
          )}

          {step === "error" && (
            <>
              <Button
                variant="outline"
                onClick={handleReset}
                data-ui-id="dialog-dataset-import-retry-btn"
              >
                Try Again
              </Button>
              <Button
                onClick={handleClose}
                data-ui-id="dialog-dataset-import-close-btn"
              >
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
