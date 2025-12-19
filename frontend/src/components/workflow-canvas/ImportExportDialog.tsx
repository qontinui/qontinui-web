/**
 * Import/Export Dialog Components
 *
 * UI components for importing and exporting workflows:
 * - ExportDialog - Export options (JSON, PNG, SVG, PDF, Markdown)
 * - ImportDialog - Import from file/URL/clipboard
 * - TemplateDialog - Template selection gallery
 * - File validation and error display
 * - Progress indicators
 */

import React, { useState, useCallback } from "react";
import { Workflow } from "../../lib/action-schema/action-types";
import {
  workflowFileManager,
  LoadResult,
} from "../../services/workflow-file-manager";
import {
  canvasExport,
  ExportFormat,
  ExportOptions,
} from "../../services/canvas-export";
import {
  workflowTemplates,
  WorkflowTemplate,
} from "../../services/workflow-templates";

// ============================================================================
// Export Dialog
// ============================================================================

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-950 border border-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-2xl font-bold mb-4 text-white">Export Workflow</h2>

        {error && (
          <div className="bg-red-950/30 border border-red-800 text-red-400 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Format Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Format
            </label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              className="w-full bg-gray-900 border border-gray-700 text-white rounded-md px-3 py-2 focus:border-[#00D9FF] focus:ring-1 focus:ring-[#00D9FF]"
            >
              <option value="json">JSON (Workflow Data)</option>
              <option value="png">PNG (Image)</option>
              <option value="svg">SVG (Vector Image)</option>
              <option value="markdown">Markdown (Documentation)</option>
            </select>
          </div>

          {/* Filename */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Filename
            </label>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 text-white rounded-md px-3 py-2 focus:border-[#00D9FF] focus:ring-1 focus:ring-[#00D9FF] placeholder:text-gray-500"
              placeholder="workflow-name"
            />
          </div>

          {/* Quality (for PNG) */}
          {format === "png" && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Quality: {Math.round(quality * 100)}%
              </label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={quality}
                onChange={(e) => setQuality(parseFloat(e.target.value))}
                className="w-full accent-[#00D9FF]"
              />
            </div>
          )}

          {/* Background (for images) */}
          {(format === "png" || format === "svg") && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Background
              </label>
              <select
                value={background}
                onChange={(e) =>
                  setBackground(
                    e.target.value as "transparent" | "white" | "grid"
                  )
                }
                className="w-full bg-gray-900 border border-gray-700 text-white rounded-md px-3 py-2 focus:border-[#00D9FF] focus:ring-1 focus:ring-[#00D9FF]"
              >
                <option value="white">White</option>
                <option value="transparent">Transparent</option>
                <option value="grid">Grid</option>
              </select>
            </div>
          )}

          {/* Include Metadata (for JSON) */}
          {format === "json" && (
            <div className="flex items-center">
              <input
                type="checkbox"
                id="includeMetadata"
                checked={includeMetadata}
                onChange={(e) => setIncludeMetadata(e.target.checked)}
                className="mr-2 accent-[#00D9FF]"
              />
              <label
                htmlFor="includeMetadata"
                className="text-sm text-gray-300"
              >
                Include metadata
              </label>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-700 text-gray-300 rounded-md hover:bg-gray-800"
            disabled={exporting}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-[#00D9FF] text-black rounded-md hover:bg-[#00D9FF]/80 disabled:opacity-50"
            disabled={exporting}
          >
            {exporting ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Import Dialog
// ============================================================================

interface ImportDialogProps {
  onImport: (workflow: Workflow) => void;
  onClose: () => void;
  open: boolean;
}

export function ImportDialog({ onImport, onClose, open }: ImportDialogProps) {
  const [importMethod, setImportMethod] = useState<
    "file" | "url" | "clipboard"
  >("file");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LoadResult | null>(null);

  const handleFileImport = useCallback(async () => {
    setLoading(true);
    setResult(null);

    try {
      const loadResult = await workflowFileManager.importWorkflow({
        validate: true,
        autoFix: true,
        migrate: true,
      });

      setResult(loadResult);

      if (loadResult.success && loadResult.workflow) {
        onImport(loadResult.workflow);
      }
    } catch (err) {
      setResult({
        success: false,
        errors: [{ type: "missing_action", message: "Import failed" }],
        warnings: [],
        migrated: false,
      });
    } finally {
      setLoading(false);
    }
  }, [onImport]);

  const handleUrlImport = useCallback(async () => {
    if (!url) return;

    setLoading(true);
    setResult(null);

    try {
      const loadResult = await workflowFileManager.loadWorkflowFromUrl(url, {
        validate: true,
        autoFix: true,
        migrate: true,
      });

      setResult(loadResult);

      if (loadResult.success && loadResult.workflow) {
        onImport(loadResult.workflow);
      }
    } catch (err) {
      setResult({
        success: false,
        errors: [{ type: "missing_action", message: "URL import failed" }],
        warnings: [],
        migrated: false,
      });
    } finally {
      setLoading(false);
    }
  }, [url, onImport]);

  const handleClipboardImport = useCallback(async () => {
    setLoading(true);
    setResult(null);

    try {
      const loadResult = await workflowFileManager.importFromClipboard({
        validate: true,
        autoFix: true,
        migrate: true,
      });

      setResult(loadResult);

      if (loadResult.success && loadResult.workflow) {
        onImport(loadResult.workflow);
      }
    } catch (err) {
      setResult({
        success: false,
        errors: [
          { type: "missing_action", message: "Clipboard import failed" },
        ],
        warnings: [],
        migrated: false,
      });
    } finally {
      setLoading(false);
    }
  }, [onImport]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-950 border border-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-2xl font-bold mb-4 text-white">Import Workflow</h2>

        <div className="space-y-4">
          {/* Import Method Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Import From
            </label>
            <div className="flex space-x-2">
              <button
                onClick={() => setImportMethod("file")}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium ${importMethod === "file" ? "bg-[#00D9FF] text-black" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
              >
                File
              </button>
              <button
                onClick={() => setImportMethod("url")}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium ${importMethod === "url" ? "bg-[#00D9FF] text-black" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
              >
                URL
              </button>
              <button
                onClick={() => setImportMethod("clipboard")}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium ${importMethod === "clipboard" ? "bg-[#00D9FF] text-black" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
              >
                Clipboard
              </button>
            </div>
          </div>

          {/* URL Input */}
          {importMethod === "url" && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Workflow URL
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 text-white rounded-md px-3 py-2 focus:border-[#00D9FF] focus:ring-1 focus:ring-[#00D9FF] placeholder:text-gray-500"
                placeholder="https://example.com/workflow.json"
              />
            </div>
          )}

          {/* Result Display */}
          {result && (
            <div
              className={`px-4 py-3 rounded border ${result.success ? "bg-green-950/30 border-green-800" : "bg-red-950/30 border-red-800"}`}
            >
              {result.success ? (
                <>
                  <p className="text-green-400 font-medium">
                    Import Successful
                  </p>
                  {result.warnings.length > 0 && (
                    <ul className="mt-2 text-sm text-green-300 list-disc list-inside">
                      {result.warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>
                  <p className="text-red-400 font-medium">Import Failed</p>
                  <ul className="mt-2 text-sm text-red-300 list-disc list-inside">
                    {result.errors.map((error, i) => (
                      <li key={i}>{error.message}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-700 text-gray-300 rounded-md hover:bg-gray-800"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (importMethod === "file") handleFileImport();
              else if (importMethod === "url") handleUrlImport();
              else handleClipboardImport();
            }}
            className="px-4 py-2 bg-[#00D9FF] text-black rounded-md hover:bg-[#00D9FF]/80 disabled:opacity-50"
            disabled={loading || (importMethod === "url" && !url)}
          >
            {loading ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Template Dialog
// ============================================================================

interface TemplateDialogProps {
  onSelect: (workflow: Workflow) => void;
  onClose: () => void;
  open: boolean;
}

export function TemplateDialog({
  onSelect,
  onClose,
  open,
}: TemplateDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");


  const templates = workflowTemplates.getTemplates({
    search: searchQuery,
    category:
      selectedCategory === "all"
        ? undefined
        : (selectedCategory as any),
  });

  const categories = ["all", ...workflowTemplates.getCategories()];

  const handleSelectTemplate = useCallback(
    (template: WorkflowTemplate) => {
      const workflow = workflowTemplates.createFromTemplate(template.id);
      if (workflow) {
        onSelect(workflow);
        onClose();
      }
    },
    [onSelect, onClose]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-950 border border-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-gray-800">
          <h2 className="text-2xl font-bold mb-4 text-white">
            Choose a Template
          </h2>

          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="w-full bg-gray-900 border border-gray-700 text-white rounded-md px-3 py-2 mb-4 focus:border-[#00D9FF] focus:ring-1 focus:ring-[#00D9FF] placeholder:text-gray-500"
          />

          {/* Category Filter */}
          <div className="flex space-x-2 overflow-x-auto">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2 rounded-md whitespace-nowrap text-sm font-medium ${selectedCategory === category ? "bg-[#00D9FF] text-black" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
              >
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Template Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
              <div
                key={template.id}
                onClick={() => handleSelectTemplate(template)}
                className="border border-gray-700 bg-gray-900 rounded-lg p-4 hover:border-[#00D9FF] hover:shadow-md cursor-pointer transition"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-lg text-white">
                    {template.name}
                  </h3>
                  {template.builtin && (
                    <span className="text-xs bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/50 px-2 py-1 rounded">
                      Built-in
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-400 mb-3">
                  {template.description}
                </p>
                <div className="flex flex-wrap gap-1">
                  {template.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {templates.length === 0 && (
            <div className="text-center text-gray-500 py-12">
              <p>No templates found</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-6 border-t border-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-700 text-gray-300 rounded-md hover:bg-gray-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
