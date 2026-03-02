import { useState, useCallback } from "react";
import { Workflow } from "../../../lib/action-schema/action-types";
import {
  workflowFileManager,
  LoadResult,
} from "../../../services/workflow-file-manager";

export type ImportMethod = "file" | "url" | "clipboard";

export function useImportDialog(onImport: (workflow: Workflow) => void) {
  const [importMethod, setImportMethod] = useState<ImportMethod>("file");
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
    } catch (_err) {
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
    } catch (_err) {
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
    } catch (_err) {
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

  const handleImport = useCallback(() => {
    if (importMethod === "file") handleFileImport();
    else if (importMethod === "url") handleUrlImport();
    else handleClipboardImport();
  }, [importMethod, handleFileImport, handleUrlImport, handleClipboardImport]);

  return {
    importMethod,
    setImportMethod,
    url,
    setUrl,
    loading,
    result,
    handleImport,
  };
}
