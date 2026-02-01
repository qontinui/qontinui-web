/**
 * Batch Import Dialog
 *
 * Dialog for importing multiple annotation files from a folder or multiple file selection.
 * Supports COCO JSON, YOLO txt, and CSV formats with progress tracking.
 */

"use client";

import { useState, useRef, useCallback } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  FolderOpen,
  FileText,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Files,
  Trash2,
} from "lucide-react";
import {
  importTrainingData,
  getImportFormatInfo,
  type ImportFormat,
} from "@/lib/training-data-import";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";

interface FileImportResult {
  fileName: string;
  status: "pending" | "importing" | "success" | "error";
  elementCount?: number;
  error?: string;
  format?: string;
}

interface BatchImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BatchImportDialog({
  open,
  onOpenChange,
}: BatchImportDialogProps) {
  const [format, setFormat] = useState<ImportFormat>("auto");
  const [files, setFiles] = useState<File[]>([]);
  const [classesContent, setClassesContent] = useState<string>("");
  const [results, setResults] = useState<FileImportResult[]>([]);
  const [importing, setImporting] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [mergeOverlapping, setMergeOverlapping] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const classesInputRef = useRef<HTMLInputElement>(null);

  const { addElements, elements, screenshotWidth, screenshotHeight } =
    useExtractionAnnotationStore();

  const formatInfo = getImportFormatInfo(format);

  // Filter files by supported extensions
  const filterSupportedFiles = useCallback((fileList: FileList | File[]): File[] => {
    const supportedExtensions = [".json", ".txt", ".csv"];
    return Array.from(fileList).filter((file) => {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      return supportedExtensions.includes(ext) && !file.name.startsWith(".");
    });
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    const supportedFiles = filterSupportedFiles(selectedFiles);
    setFiles((prev) => {
      // Avoid duplicates by file name
      const existingNames = new Set(prev.map((f) => f.name));
      const newFiles = supportedFiles.filter((f) => !existingNames.has(f.name));
      return [...prev, ...newFiles];
    });

    // Reset results when new files are added
    setResults([]);

    // Reset the input
    e.target.value = "";
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    const supportedFiles = filterSupportedFiles(selectedFiles);
    setFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const newFiles = supportedFiles.filter((f) => !existingNames.has(f.name));
      return [...prev, ...newFiles];
    });

    setResults([]);
    e.target.value = "";
  };

  const handleClassesFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      setClassesContent(content);
    } catch {
      toast.error("Failed to read classes file");
    }
  };

  const removeFile = (fileName: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== fileName));
    setResults((prev) => prev.filter((r) => r.fileName !== fileName));
  };

  const clearAllFiles = () => {
    setFiles([]);
    setResults([]);
  };

  const handleImport = async () => {
    if (files.length === 0) {
      toast.error("Please select files to import");
      return;
    }

    setImporting(true);

    // Initialize results
    const initialResults: FileImportResult[] = files.map((f) => ({
      fileName: f.name,
      status: "pending",
    }));
    setResults(initialResults);

    let totalImported = 0;
    let successCount = 0;
    let errorCount = 0;
    const allElements: Parameters<typeof addElements>[0] = [];

    // Process files sequentially to show progress
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;

      // Update status to importing
      setResults((prev) =>
        prev.map((r, idx) =>
          idx === i ? { ...r, status: "importing" } : r
        )
      );

      try {
        const content = await file.text();

        const result = importTrainingData(content, {
          format,
          screenshotWidth: screenshotWidth || 1920,
          screenshotHeight: screenshotHeight || 1080,
          classesContent: classesContent || undefined,
        });

        if (result.error) {
          setResults((prev) =>
            prev.map((r, idx) =>
              idx === i
                ? { ...r, status: "error", error: result.error }
                : r
            )
          );
          errorCount++;
          continue;
        }

        if (result.elements.length === 0) {
          setResults((prev) =>
            prev.map((r, idx) =>
              idx === i
                ? { ...r, status: "error", error: "No annotations found" }
                : r
            )
          );
          errorCount++;
          continue;
        }

        // Filter duplicates if enabled
        let elementsToAdd = result.elements;
        if (skipDuplicates) {
          const existingLabels = new Set([
            ...elements.map((e) => `${e.label}-${e.bbox.x}-${e.bbox.y}`),
            ...allElements.map((e) => `${e.label}-${e.bbox.x}-${e.bbox.y}`),
          ]);
          elementsToAdd = result.elements.filter(
            (e) => !existingLabels.has(`${e.label}-${e.bbox.x}-${e.bbox.y}`)
          );
        }

        allElements.push(...elementsToAdd);
        totalImported += elementsToAdd.length;
        successCount++;

        setResults((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  status: "success",
                  elementCount: elementsToAdd.length,
                  format: result.format,
                }
              : r
          )
        );
      } catch (err) {
        setResults((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  status: "error",
                  error: err instanceof Error ? err.message : "Unknown error",
                }
              : r
          )
        );
        errorCount++;
      }

      // Small delay for visual feedback
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Add all elements at once
    if (allElements.length > 0) {
      addElements(allElements);
    }

    setImporting(false);

    // Show summary toast
    if (errorCount === 0) {
      toast.success(
        `Successfully imported ${totalImported} annotations from ${successCount} file(s)`
      );
    } else if (successCount > 0) {
      toast.warning(
        `Imported ${totalImported} annotations from ${successCount} file(s). ${errorCount} file(s) failed.`
      );
    } else {
      toast.error(`All ${errorCount} file(s) failed to import`);
    }
  };

  const handleClose = () => {
    if (!importing) {
      setFiles([]);
      setResults([]);
      setClassesContent("");
      onOpenChange(false);
    }
  };

  const completedCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const progress = results.length > 0
    ? ((completedCount + errorCount) / results.length) * 100
    : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
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
          {/* Format Selection */}
          <div className="space-y-2">
            <Label htmlFor="batch-format">Format</Label>
            <Select
              value={format}
              onValueChange={(v) => setFormat(v as ImportFormat)}
              disabled={importing}
            >
              <SelectTrigger id="batch-format">
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

          {/* File/Folder Selection */}
          <div className="space-y-2">
            <Label>Select Files or Folder</Label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                <FileText className="h-4 w-4 mr-2" />
                Select Files
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => folderInputRef.current?.click()}
                disabled={importing}
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Select Folder
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".json,.txt,.csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              <input
                ref={folderInputRef}
                type="file"
                // @ts-expect-error - webkitdirectory is not in types
                webkitdirectory=""
                directory=""
                onChange={handleFolderSelect}
                className="hidden"
              />
            </div>
          </div>

          {/* Classes file for YOLO */}
          {format === "yolo" && (
            <div className="space-y-2">
              <Label>Classes File (optional)</Label>
              <div
                className="border-2 border-dashed rounded-lg p-3 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => !importing && classesInputRef.current?.click()}
              >
                <input
                  ref={classesInputRef}
                  type="file"
                  accept=".txt"
                  onChange={handleClassesFileSelect}
                  className="hidden"
                />
                {classesContent ? (
                  <span className="text-sm text-primary">classes.txt loaded</span>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Upload classes.txt for class names
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Options */}
          <div className="space-y-3 p-3 rounded-lg bg-surface-canvas border border-border-subtle">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Skip Duplicates</Label>
                <p className="text-xs text-muted-foreground">
                  Skip elements with same label and position
                </p>
              </div>
              <Switch
                checked={skipDuplicates}
                onCheckedChange={setSkipDuplicates}
                disabled={importing}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Merge Overlapping</Label>
                <p className="text-xs text-muted-foreground">
                  Combine elements with significant overlap
                </p>
              </div>
              <Switch
                checked={mergeOverlapping}
                onCheckedChange={setMergeOverlapping}
                disabled={importing}
              />
            </div>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{files.length} file(s) selected</Label>
                {!importing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFiles}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Clear All
                  </Button>
                )}
              </div>

              {importing && (
                <div className="space-y-1">
                  <Progress value={progress} className="h-2" />
                  <p className="text-xs text-muted-foreground text-center">
                    Processing {completedCount + errorCount} of {results.length} files...
                  </p>
                </div>
              )}

              <ScrollArea className="h-[200px] rounded-md border">
                <div className="p-2 space-y-1">
                  {files.map((file, idx) => {
                    const result = results[idx];
                    return (
                      <div
                        key={file.name}
                        className="flex items-center justify-between p-2 rounded hover:bg-accent/50 text-sm"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {result?.status === "importing" && (
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          )}
                          {result?.status === "success" && (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          )}
                          {result?.status === "error" && (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                          {(!result || result.status === "pending") && (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="truncate">{file.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {result?.status === "success" && (
                            <Badge variant="outline" className="text-xs">
                              {result.elementCount} elements
                            </Badge>
                          )}
                          {result?.status === "error" && (
                            <span className="text-xs text-destructive truncate max-w-[150px]">
                              {result.error}
                            </span>
                          )}
                          {!importing && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => removeFile(file.name)}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Empty state */}
          {files.length === 0 && (
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                Click to select files or use the buttons above
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Supports .json, .txt, .csv files
              </p>
            </div>
          )}

          {/* Summary after import */}
          {results.length > 0 && !importing && (
            <div className="flex items-center gap-4 p-3 rounded-lg bg-surface-canvas border border-border-subtle">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm">{completedCount} succeeded</span>
              </div>
              {errorCount > 0 && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm">{errorCount} failed</span>
                </div>
              )}
              <div className="flex-1" />
              <span className="text-sm text-muted-foreground">
                {results.reduce((sum, r) => sum + (r.elementCount || 0), 0)} total elements
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={importing}>
            {results.length > 0 && !importing ? "Close" : "Cancel"}
          </Button>
          <Button
            onClick={handleImport}
            disabled={files.length === 0 || importing}
            className="bg-[#9B59B6] hover:bg-[#9B59B6]/90"
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Import {files.length} File{files.length !== 1 ? "s" : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
