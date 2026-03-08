import React from "react";
import { Workflow } from "../../../lib/action-schema/action-types";
import { useImportDialog, ImportMethod } from "../_hooks/use-import-dialog";

interface ImportDialogProps {
  onImport: (workflow: Workflow) => void;
  onClose: () => void;
  open: boolean;
}

const IMPORT_METHODS: { value: ImportMethod; label: string }[] = [
  { value: "file", label: "File" },
  { value: "url", label: "URL" },
  { value: "clipboard", label: "Clipboard" },
];

export function ImportDialog({ onImport, onClose, open }: ImportDialogProps) {
  const {
    importMethod,
    setImportMethod,
    url,
    setUrl,
    loading,
    result,
    handleImport,
  } = useImportDialog(onImport);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-surface-canvas border border-border-subtle rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-2xl font-bold mb-4 text-white">Import Workflow</h2>

        <div className="space-y-4">
          <div>
            <p className="block text-sm font-medium text-text-secondary mb-2">
              Import From
            </p>
            <div className="flex space-x-2">
              {IMPORT_METHODS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setImportMethod(value)}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium ${importMethod === value ? "bg-brand-primary text-black" : "bg-surface-raised text-text-secondary hover:bg-surface-raised/80"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {importMethod === "url" && (
            <div>
              <label
                htmlFor="ied-url"
                className="block text-sm font-medium text-text-secondary mb-2"
              >
                Workflow URL
              </label>
              <input
                id="ied-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-surface-canvas border border-border-default text-white rounded-md px-3 py-2 focus:border-brand-primary focus:ring-1 focus:ring-brand-primary placeholder:text-text-muted"
                placeholder="https://example.com/workflow.json"
              />
            </div>
          )}

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

        <div className="flex justify-end space-x-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border-default text-text-secondary rounded-md hover:bg-surface-raised"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            className="px-4 py-2 bg-brand-primary text-black rounded-md hover:bg-brand-primary/80 disabled:opacity-50"
            disabled={loading || (importMethod === "url" && !url)}
          >
            {loading ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
