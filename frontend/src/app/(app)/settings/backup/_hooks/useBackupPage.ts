"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useRunnerHealth,
  runnerApi,
  type BackupSummary,
} from "@/lib/runner-api";
import { toast } from "sonner";
import {
  createDefaultOptions,
  ALL_CATEGORIES,
  type ImportResult,
  type ImportOptions,
} from "../_types/backup";

export function useBackupPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [exportOptions, setExportOptions] =
    useState<Record<string, boolean>>(createDefaultOptions);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importPreview, setImportPreview] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    conflict_resolution: "skip",
    categories: createDefaultOptions(),
  });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const data = await runnerApi.getBackupSummary();
      setSummary(data);
    } catch {
      toast.error("Failed to load data summary");
    }
  }, []);

  useEffect(() => {
    if (isOffline) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      await loadSummary();
      setLoading(false);
    })();
  }, [isOffline, loadSummary]);

  const selectedExportCount =
    summary != null
      ? ALL_CATEGORIES.filter((k) => exportOptions[k]).reduce(
          (acc, k) =>
            acc + ((summary as unknown as Record<string, number>)[k] ?? 0),
          0
        )
      : 0;

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await runnerApi.exportBackup(exportOptions);
      const blob = new Blob([JSON.stringify(result, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().split("T")[0];
      const a = document.createElement("a");
      a.href = url;
      a.download = `qontinui-backup-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Backup exported successfully");
    } catch (err) {
      toast.error(
        `Export failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelected = async (file: File) => {
    setImportResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, unknown>;
      setImportPreview(data);

      const categories: Record<string, boolean> = {};
      for (const key of ALL_CATEGORIES) {
        categories[key] = key in data;
      }
      setImportOptions((prev) => ({ ...prev, categories }));
    } catch {
      toast.error("Invalid JSON file");
      setImportPreview(null);
    }
  };

  const handleImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const result = await runnerApi.importBackup(importPreview, {
        conflict_resolution: importOptions.conflict_resolution,
        categories: importOptions.categories,
      });
      setImportResult(result);
      toast.success(
        `Import complete: ${result.imported} imported, ${result.skipped} skipped`
      );
      await loadSummary();
    } catch (err) {
      toast.error(
        `Import failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setImporting(false);
    }
  };

  return {
    isOffline,
    healthLoading,
    loading,
    summary,
    exportOptions,
    setExportOptions,
    showExportOptions,
    setShowExportOptions,
    exporting,
    selectedExportCount,
    handleExport,
    importPreview,
    importOptions,
    setImportOptions,
    importing,
    importResult,
    handleFileSelected,
    handleImport,
    loadSummary,
  };
}
