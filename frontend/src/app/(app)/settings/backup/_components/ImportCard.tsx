import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Upload, FileArchive } from "lucide-react";
import {
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  type ImportOptions,
} from "../_types/backup";

export function ImportCard({
  importPreview,
  importOptions,
  setImportOptions,
  importing,
  onFileSelected,
  onImport,
}: {
  importPreview: Record<string, unknown> | null;
  importOptions: ImportOptions;
  setImportOptions: React.Dispatch<React.SetStateAction<ImportOptions>>;
  importing: boolean;
  onFileSelected: (file: File) => void;
  onImport: () => void;
}) {
  return (
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
        <div className="space-y-1.5">
          <Label htmlFor="backup-file" className="text-sm text-foreground">
            Backup File
          </Label>
          <Input
            id="backup-file"
            type="file"
            accept=".json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFileSelected(file);
            }}
            className="bg-muted border-border text-sm file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:text-xs file:text-primary file:cursor-pointer"
          />
        </div>

        {importPreview && (
          <ImportPreview
            importPreview={importPreview}
            importOptions={importOptions}
            setImportOptions={setImportOptions}
            importing={importing}
            onImport={onImport}
          />
        )}
      </div>
    </div>
  );
}

function ImportPreview({
  importPreview,
  importOptions,
  setImportOptions,
  importing,
  onImport,
}: {
  importPreview: Record<string, unknown>;
  importOptions: ImportOptions;
  setImportOptions: React.Dispatch<React.SetStateAction<ImportOptions>>;
  importing: boolean;
  onImport: () => void;
}) {
  return (
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

      {!!(
        importPreview.version ||
        importPreview.app_version ||
        importPreview.created_at
      ) && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {!!importPreview.version && (
            <span data-content-role="label" data-content-label="backup version">
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
              {new Date(String(importPreview.created_at)).toLocaleString()}
            </span>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Conflict Resolution</p>
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

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {ALL_CATEGORIES.map((key) => {
          const inBackup = key in importPreview;
          const backupData = importPreview[key];
          const count = Array.isArray(backupData) ? backupData.length : 0;
          return (
            <div
              key={key}
              className={`flex items-center gap-2 text-xs cursor-pointer ${
                inBackup ? "text-foreground" : "text-muted-foreground/50"
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
                  <span className="text-muted-foreground ml-1">({count})</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <Button
        variant="brand-primary"
        size="sm"
        onClick={onImport}
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
  );
}
