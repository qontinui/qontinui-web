import { useState, useCallback } from "react";
import { Workflow } from "../../../lib/action-schema/action-types";
import {
  canvasExport,
  ExportFormat,
  ExportOptions,
} from "../../../services/canvas-export";

export function useExportDialog(
  workflow: Workflow,
  canvasElement: HTMLElement | null | undefined,
  onClose: () => void
) {
  const [format, setFormat] = useState<ExportFormat>("json");
  const [filename, setFilename] = useState(workflow.name);
  const [quality, setQuality] = useState(0.95);
  const [background, setBackground] = useState<
    "transparent" | "white" | "grid"
  >("white");
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setError(null);

    try {
      const options: ExportOptions = {
        format,
        filename: filename || workflow.name,
        quality,
        background,
        includeMetadata,
      };

      const result = await canvasExport.export(
        workflow,
        canvasElement || null,
        options
      );

      if (!result.success) {
        setError(result.error || "Export failed");
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [
    format,
    filename,
    quality,
    background,
    includeMetadata,
    workflow,
    canvasElement,
    onClose,
  ]);

  return {
    format,
    setFormat,
    filename,
    setFilename,
    quality,
    setQuality,
    background,
    setBackground,
    includeMetadata,
    setIncludeMetadata,
    exporting,
    error,
    handleExport,
  };
}
