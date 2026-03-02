"use client";

import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  importTrainingData,
  type ImportFormat,
} from "@/lib/training-data-import";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";
import type { FileImportResult, BatchImportState } from "./batch-import-types";

export function useBatchImport(
  onOpenChange: (open: boolean) => void
): BatchImportState {
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

  const filterSupportedFiles = useCallback(
    (fileList: FileList | File[]): File[] => {
      const supportedExtensions = [".json", ".txt", ".csv"];
      return Array.from(fileList).filter((file) => {
        const ext = "." + file.name.split(".").pop()?.toLowerCase();
        return supportedExtensions.includes(ext) && !file.name.startsWith(".");
      });
    },
    []
  );

  const addNewFiles = useCallback(
    (selectedFiles: FileList) => {
      const supportedFiles = filterSupportedFiles(selectedFiles);
      setFiles((prev) => {
        const existingNames = new Set(prev.map((f) => f.name));
        const newFiles = supportedFiles.filter(
          (f) => !existingNames.has(f.name)
        );
        return [...prev, ...newFiles];
      });
      setResults([]);
    },
    [filterSupportedFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (!selectedFiles) return;
      addNewFiles(selectedFiles);
      e.target.value = "";
    },
    [addNewFiles]
  );

  const handleFolderSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (!selectedFiles) return;
      addNewFiles(selectedFiles);
      e.target.value = "";
    },
    [addNewFiles]
  );

  const handleClassesFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const content = await file.text();
        setClassesContent(content);
      } catch {
        toast.error("Failed to read classes file");
      }
    },
    []
  );

  const removeFile = useCallback((fileName: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== fileName));
    setResults((prev) => prev.filter((r) => r.fileName !== fileName));
  }, []);

  const clearAllFiles = useCallback(() => {
    setFiles([]);
    setResults([]);
  }, []);

  const handleImport = useCallback(async () => {
    if (files.length === 0) {
      toast.error("Please select files to import");
      return;
    }

    setImporting(true);

    const initialResults: FileImportResult[] = files.map((f) => ({
      fileName: f.name,
      status: "pending",
    }));
    setResults(initialResults);

    let totalImported = 0;
    let successCount = 0;
    let errorCount = 0;
    const allElements: Parameters<typeof addElements>[0] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;

      setResults((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, status: "importing" } : r))
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
              idx === i ? { ...r, status: "error", error: result.error } : r
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

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (allElements.length > 0) {
      addElements(allElements);
    }

    setImporting(false);

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
  }, [
    files,
    format,
    screenshotWidth,
    screenshotHeight,
    classesContent,
    skipDuplicates,
    elements,
    addElements,
  ]);

  const handleClose = useCallback(() => {
    if (!importing) {
      setFiles([]);
      setResults([]);
      setClassesContent("");
      onOpenChange(false);
    }
  }, [importing, onOpenChange]);

  const completedCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const progress =
    results.length > 0
      ? ((completedCount + errorCount) / results.length) * 100
      : 0;

  return {
    format,
    setFormat,
    files,
    classesContent,
    results,
    importing,
    skipDuplicates,
    setSkipDuplicates,
    mergeOverlapping,
    setMergeOverlapping,
    fileInputRef,
    folderInputRef,
    classesInputRef,
    handleFileSelect,
    handleFolderSelect,
    handleClassesFileSelect,
    removeFile,
    clearAllFiles,
    handleImport,
    handleClose,
    completedCount,
    errorCount,
    progress,
  };
}
