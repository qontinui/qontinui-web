import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  Download,
  Settings,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "../_types/backup";

export function ExportCard({
  exportOptions,
  setExportOptions,
  showExportOptions,
  setShowExportOptions,
  exporting,
  selectedExportCount,
  onExport,
}: {
  exportOptions: Record<string, boolean>;
  setExportOptions: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  showExportOptions: boolean;
  setShowExportOptions: React.Dispatch<React.SetStateAction<boolean>>;
  exporting: boolean;
  selectedExportCount: number;
  onExport: () => void;
}) {
  return (
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
              <div
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
              </div>
            ))}
          </div>
        )}

        <Button
          variant="brand-primary"
          size="sm"
          onClick={onExport}
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
  );
}
