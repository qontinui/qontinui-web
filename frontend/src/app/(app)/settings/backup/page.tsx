"use client";

import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Loader2, Archive } from "lucide-react";
import { useBackupPage } from "./_hooks/useBackupPage";
import { DataSummaryCard } from "./_components/DataSummaryCard";
import { ExportCard } from "./_components/ExportCard";
import { ImportCard } from "./_components/ImportCard";
import { ImportResultDisplay } from "./_components/ImportResultDisplay";

export default function BackupSettingsPage() {
  const {
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
  } = useBackupPage();

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
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Archive className="size-5" />
          Backup
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Export and restore your data
        </p>
      </div>

      <DataSummaryCard summary={summary} onRefresh={loadSummary} />

      <ExportCard
        exportOptions={exportOptions}
        setExportOptions={setExportOptions}
        showExportOptions={showExportOptions}
        setShowExportOptions={setShowExportOptions}
        exporting={exporting}
        selectedExportCount={selectedExportCount}
        onExport={handleExport}
      />

      <ImportCard
        importPreview={importPreview}
        importOptions={importOptions}
        setImportOptions={setImportOptions}
        importing={importing}
        onFileSelected={handleFileSelected}
        onImport={handleImport}
      />

      {importResult && <ImportResultDisplay result={importResult} />}
    </div>
  );
}
