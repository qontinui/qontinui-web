import React from "react";
import { Workflow } from "../../../lib/action-schema/action-types";
import { ExportFormat } from "../../../services/canvas-export";
import { useExportDialog } from "../_hooks/use-export-dialog";

interface ExportDialogProps {
  workflow: Workflow;
  canvasElement?: HTMLElement | null;
  onClose: () => void;
  open: boolean;
}

export function ExportDialog({
  workflow,
  canvasElement,
  onClose,
  open,
}: ExportDialogProps) {
  const {
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
  } = useExportDialog(workflow, canvasElement, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-surface-canvas border border-border-subtle rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-2xl font-bold mb-4 text-white">Export Workflow</h2>

        {error && (
          <div className="bg-red-950/30 border border-red-800 text-red-400 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label
              htmlFor="ied-format"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Format
            </label>
            <select
              id="ied-format"
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              className="w-full bg-surface-canvas border border-border-default text-white rounded-md px-3 py-2 focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
            >
              <option value="json">JSON (Workflow Data)</option>
              <option value="png">PNG (Image)</option>
              <option value="svg">SVG (Vector Image)</option>
              <option value="markdown">Markdown (Documentation)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="ied-filename"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Filename
            </label>
            <input
              id="ied-filename"
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="w-full bg-surface-canvas border border-border-default text-white rounded-md px-3 py-2 focus:border-brand-primary focus:ring-1 focus:ring-brand-primary placeholder:text-text-muted"
              placeholder="workflow-name"
            />
          </div>

          {format === "png" && (
            <div>
              <label
                htmlFor="ied-quality"
                className="block text-sm font-medium text-text-secondary mb-2"
              >
                Quality: {Math.round(quality * 100)}%
              </label>
              <input
                id="ied-quality"
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={quality}
                onChange={(e) => setQuality(parseFloat(e.target.value))}
                className="w-full accent-brand-primary"
              />
            </div>
          )}

          {(format === "png" || format === "svg") && (
            <div>
              <label
                htmlFor="ied-background"
                className="block text-sm font-medium text-text-secondary mb-2"
              >
                Background
              </label>
              <select
                id="ied-background"
                value={background}
                onChange={(e) =>
                  setBackground(
                    e.target.value as "transparent" | "white" | "grid"
                  )
                }
                className="w-full bg-surface-canvas border border-border-default text-white rounded-md px-3 py-2 focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
              >
                <option value="white">White</option>
                <option value="transparent">Transparent</option>
                <option value="grid">Grid</option>
              </select>
            </div>
          )}

          {format === "json" && (
            <div className="flex items-center">
              <input
                type="checkbox"
                id="includeMetadata"
                checked={includeMetadata}
                onChange={(e) => setIncludeMetadata(e.target.checked)}
                className="mr-2 accent-brand-primary"
              />
              <label
                htmlFor="includeMetadata"
                className="text-sm text-text-secondary"
              >
                Include metadata
              </label>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border-default text-text-secondary rounded-md hover:bg-surface-raised"
            disabled={exporting}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-brand-primary text-black rounded-md hover:bg-brand-primary/80 disabled:opacity-50"
            disabled={exporting}
          >
            {exporting ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
