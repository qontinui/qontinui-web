"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useRunnerHealth,
  runnerApi,
  type BackupSummary,
} from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Loader2,
  Archive,
  Database,
  Download,
  Upload,
  FileArchive,
  Settings,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  CheckCircle,
  AlertCircle,
} from "lucide-react";

// ============================================================================
// Constants
// ============================================================================

const CATEGORY_LABELS: Record<string, string> = {
  flows: "Flows",
  flow_executions: "Flow Executions",
  checkpoints: "Checkpoints",
  learning_outcomes: "Learning Outcomes",
  learning_patterns: "Learning Patterns",
  settings: "Settings",
  prompts: "Prompts",
  unified_workflows: "Unified Workflows",
  verification_tests: "Verification Tests",
  task_hooks: "Task Hooks",
  scheduled_tasks: "Scheduled Tasks",
  saved_api_requests: "Saved API Requests",
  configs: "Configurations",
};

const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);

function createDefaultOptions(): Record<string, boolean> {
  const options: Record<string, boolean> = {};
  for (const key of ALL_CATEGORIES) {
    options[key] = true;
  }
  return options;
}

// ============================================================================
// Import Result Display
// ============================================================================

function ImportResultDisplay({
  result,
}: {
  result: {
    imported: number;
    skipped: number;
    errors: number;
    details: Record<
      string,
      { imported: number; skipped: number; errors: number }
    >;
  };
}) {
  return (
    <div className="rounded-lg border border-border">
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <h3 className="text-sm font-medium flex items-center gap-2">
          {result.errors === 0 ? (
            <CheckCircle className="size-4 text-green-400" />
          ) : (
            <AlertCircle className="size-4 text-amber-400" />
          )}
          Import Complete
        </h3>
        <p className="text-xs text-muted-foreground">
          {result.imported} imported, {result.skipped} skipped, {result.errors}{" "}
          errors
        </p>
      </div>
      <div className="p-4">
        <div className="space-y-1">
          {Object.entries(result.details).map(([key, detail]) => (
            <div
              key={key}
              className="flex items-center justify-between py-1.5 px-2 rounded bg-background text-xs"
            >
              <span
                data-content-role="label"
                data-content-label="import category"
                className="text-foreground"
              >
                {CATEGORY_LABELS[key] ?? key}
              </span>
              <div className="flex items-center gap-3 text-muted-foreground">
                {detail.imported > 0 && (
                  <span
                    data-content-role="metric"
                    data-content-label="imported count"
                    className="text-green-400"
                  >
                    +{detail.imported} imported
                  </span>
                )}
                {detail.skipped > 0 && (
                  <span
                    data-content-role="metric"
                    data-content-label="skipped count"
                    className="text-amber-400"
                  >
                    {detail.skipped} skipped
                  </span>
                )}
                {detail.errors > 0 && (
                  <span
                    data-content-role="metric"
                    data-content-label="error count"
                    className="text-red-400"
                  >
                    {detail.errors} errors
                  </span>
                )}
                {detail.imported === 0 &&
                  detail.skipped === 0 &&
                  detail.errors === 0 && <span>--</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function BackupSettingsPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const [loading, setLoading] = useState(true);

  // Data summary
  const [summary, setSummary] = useState<BackupSummary | null>(null);

  // Export state
  const [exportOptions, setExportOptions] =
    useState<Record<string, boolean>>(createDefaultOptions);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Import state
  const [importPreview, setImportPreview] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [importOptions, setImportOptions] = useState<{
    conflict_resolution: string;
    categories: Record<string, boolean>;
  }>({
    conflict_resolution: "skip",
    categories: createDefaultOptions(),
  });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    errors: number;
    details: Record<
      string,
      { imported: number; skipped: number; errors: number }
    >;
  } | null>(null);

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

  // Count total selected items for export
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
      // Download as JSON file
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

      // Set import category options based on what's in the file
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
      // Reload summary
      await loadSummary();
    } catch (err) {
      toast.error(
        `Import failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setImporting(false);
    }
  };

  if (healthLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Archive className="size-5" />
          Backup
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Export and restore your data
        </p>
      </div>

      {/* ================================================================ */}
      {/* Your Data Summary */}
      {/* ================================================================ */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Database className="size-4" />
                Your Data Summary
              </h3>
              <p className="text-xs text-muted-foreground">
                Overview of all stored data categories
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadSummary}
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>
        <div className="p-4">
          {summary ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {ALL_CATEGORIES.map((key) => {
                const count =
                  (summary as unknown as Record<string, number>)[key] ?? 0;
                return (
                  <div
                    key={key}
                    className="flex flex-col items-center gap-1 p-2.5 rounded-lg bg-background border border-border"
                  >
                    <span
                      data-content-role="metric"
                      data-content-label="category count"
                      className="text-lg font-semibold text-foreground"
                    >
                      {count}
                    </span>
                    <span
                      data-content-role="label"
                      data-content-label="category name"
                      className="text-[11px] text-muted-foreground text-center leading-tight"
                    >
                      {CATEGORY_LABELS[key]}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No data available
            </p>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* Export All Data */}
      {/* ================================================================ */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Download className="size-4" />
            Export All Data
          </h3>
          <p className="text-xs text-muted-foreground">
            Download a JSON backup of your data
          </p>
        </div>
        <div className="p-4 space-y-4">
          {/* Toggle export options */}
          <button
            onClick={() => setShowExportOptions(!showExportOptions)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showExportOptions ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
            <Settings className="size-4" />
            Export Options
          </button>

          {showExportOptions && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 rounded-lg bg-background border border-border">
              {ALL_CATEGORIES.map((key) => (
                <label
                  key={key}
                  className="flex items-center gap-2 text-xs text-foreground cursor-pointer"
                >
                  <Switch
                    checked={exportOptions[key] ?? true}
                    onCheckedChange={(v) =>
                      setExportOptions((prev) => ({ ...prev, [key]: v }))
                    }
                  />
                  <span>{CATEGORY_LABELS[key]}</span>
                </label>
              ))}
            </div>
          )}

          <Button
            variant="brand-primary"
            size="sm"
            onClick={handleExport}
            disabled={exporting || selectedExportCount === 0}
          >
            {exporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Export ({selectedExportCount} items)
          </Button>
        </div>
      </div>

      {/* ================================================================ */}
      {/* Import Data */}
      {/* ================================================================ */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Upload className="size-4" />
            Import Data
          </h3>
          <p className="text-xs text-muted-foreground">
            Restore data from a previously exported JSON backup
          </p>
        </div>
        <div className="p-4 space-y-4">
          {/* File input */}
          <div className="space-y-1.5">
            <Label className="text-sm text-foreground">Backup File</Label>
            <Input
              type="file"
              accept=".json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelected(file);
              }}
              className="bg-muted border-border text-sm file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:text-xs file:text-primary file:cursor-pointer"
            />
          </div>

          {/* Import Preview */}
          {importPreview && (
            <div className="space-y-4 p-4 rounded-lg bg-background border border-border">
              <div className="flex items-center gap-2">
                <FileArchive className="size-4 text-muted-foreground" />
                <span
                  data-content-role="heading"
                  data-content-label="import preview"
                  className="text-sm font-medium text-foreground"
                >
                  Import Preview
                </span>
              </div>

              {/* Metadata */}
              {!!(
                importPreview.version ||
                importPreview.app_version ||
                importPreview.created_at
              ) && (
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {!!importPreview.version && (
                    <span
                      data-content-role="label"
                      data-content-label="backup version"
                    >
                      Version: {String(importPreview.version)}
                    </span>
                  )}
                  {!!importPreview.app_version && (
                    <span
                      data-content-role="label"
                      data-content-label="backup app version"
                    >
                      App: {String(importPreview.app_version)}
                    </span>
                  )}
                  {!!importPreview.created_at && (
                    <span
                      data-content-role="label"
                      data-content-label="backup created date"
                    >
                      Created:{" "}
                      {new Date(
                        String(importPreview.created_at)
                      ).toLocaleString()}
                    </span>
                  )}
                </div>
              )}

              {/* Conflict resolution */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Conflict Resolution
                </Label>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setImportOptions((prev) => ({
                        ...prev,
                        conflict_resolution: "skip",
                      }))
                    }
                    className={`px-3 py-1.5 rounded text-xs transition-colors ${
                      importOptions.conflict_resolution === "skip"
                        ? "bg-primary/10 border border-primary/30 text-primary"
                        : "bg-background border border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Skip existing
                  </button>
                  <button
                    onClick={() =>
                      setImportOptions((prev) => ({
                        ...prev,
                        conflict_resolution: "overwrite",
                      }))
                    }
                    className={`px-3 py-1.5 rounded text-xs transition-colors ${
                      importOptions.conflict_resolution === "overwrite"
                        ? "bg-primary/10 border border-primary/30 text-primary"
                        : "bg-background border border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Overwrite
                  </button>
                </div>
              </div>

              {/* Category checkboxes */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ALL_CATEGORIES.map((key) => {
                  const inBackup = key in importPreview;
                  const backupData = importPreview[key];
                  const count = Array.isArray(backupData)
                    ? backupData.length
                    : 0;
                  return (
                    <label
                      key={key}
                      className={`flex items-center gap-2 text-xs cursor-pointer ${
                        inBackup
                          ? "text-foreground"
                          : "text-muted-foreground/50"
                      }`}
                    >
                      <Switch
                        checked={importOptions.categories[key] ?? false}
                        onCheckedChange={(v) =>
                          setImportOptions((prev) => ({
                            ...prev,
                            categories: { ...prev.categories, [key]: v },
                          }))
                        }
                        disabled={!inBackup}
                      />
                      <span>
                        {CATEGORY_LABELS[key]}
                        {inBackup && count > 0 && (
                          <span className="text-muted-foreground ml-1">
                            ({count})
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>

              <Button
                variant="brand-primary"
                size="sm"
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Import Data
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* Import Result */}
      {/* ================================================================ */}
      {importResult && <ImportResultDisplay result={importResult} />}
    </div>
  );
}
