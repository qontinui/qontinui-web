/**
 * Annotation Import Dialog
 *
 * Dialog for importing annotations from COCO, YOLO, or CSV files.
 */

"use client";

import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Upload, FileText, AlertCircle } from "lucide-react";
import {
  importTrainingData,
  getImportFormatInfo,
  type ImportFormat,
} from "@/lib/training-data-import";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";

interface AnnotationImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AnnotationImportDialog({
  open,
  onOpenChange,
}: AnnotationImportDialogProps) {
  const [format, setFormat] = useState<ImportFormat>("auto");
  const [fileContent, setFileContent] = useState<string>("");
  const [classesContent, setClassesContent] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const classesInputRef = useRef<HTMLInputElement>(null);

  const { addElements, screenshotWidth, screenshotHeight } =
    useExtractionAnnotationStore();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);

    try {
      const content = await file.text();
      setFileContent(content);
    } catch (_err) {
      setError("Failed to read file");
    }
  };

  const handleClassesFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      setClassesContent(content);
    } catch (_err) {
      setError("Failed to read classes file");
    }
  };

  const handleImport = () => {
    if (!fileContent) {
      setError("Please select a file to import");
      return;
    }

    setImporting(true);
    setError(null);

    const result = importTrainingData(fileContent, {
      format,
      screenshotWidth: screenshotWidth || 1920,
      screenshotHeight: screenshotHeight || 1080,
      classesContent: classesContent || undefined,
    });

    if (result.error) {
      setError(result.error);
      setImporting(false);
      return;
    }

    if (result.elements.length === 0) {
      setError("No annotations found in the file");
      setImporting(false);
      return;
    }

    // Add elements to the store
    addElements(result.elements);

    toast.success(
      `Imported ${result.elements.length} annotation(s) from ${result.format.toUpperCase()}`
    );

    // Reset and close
    setFileContent("");
    setClassesContent("");
    setFileName("");
    setImporting(false);
    onOpenChange(false);
  };

  const formatInfo = getImportFormatInfo(format);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import Annotations</DialogTitle>
          <DialogDescription>
            Import annotations from COCO JSON, YOLO txt, or CSV files.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Format Selection */}
          <div className="space-y-2">
            <Label htmlFor="format">Format</Label>
            <Select
              value={format}
              onValueChange={(v) => setFormat(v as ImportFormat)}
            >
              <SelectTrigger id="format">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect</SelectItem>
                <SelectItem value="coco">COCO JSON</SelectItem>
                <SelectItem value="yolo">YOLO</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {formatInfo.description}
            </p>
          </div>

          {/* File Upload */}
          <div className="space-y-2">
            <Label>Annotations File</Label>
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={formatInfo.extensions.join(",")}
                onChange={handleFileSelect}
                className="hidden"
              />
              {fileName ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">{fileName}</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Click to select a file or drag and drop
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatInfo.extensions.join(", ")}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Classes file for YOLO */}
          {format === "yolo" && (
            <div className="space-y-2">
              <Label>Classes File (optional)</Label>
              <div
                className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => classesInputRef.current?.click()}
              >
                <input
                  ref={classesInputRef}
                  type="file"
                  accept=".txt"
                  onChange={handleClassesFileSelect}
                  className="hidden"
                />
                {classesContent ? (
                  <span className="text-sm text-primary">
                    classes.txt loaded
                  </span>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Upload classes.txt for class names
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Preview */}
          {fileContent && (
            <div className="space-y-2">
              <Label>Preview</Label>
              <Textarea
                value={
                  fileContent.slice(0, 500) +
                  (fileContent.length > 500 ? "..." : "")
                }
                readOnly
                className="h-24 font-mono text-xs"
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!fileContent || importing}>
            {importing ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
