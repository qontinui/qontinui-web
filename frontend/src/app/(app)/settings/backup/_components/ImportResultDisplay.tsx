import { CheckCircle, AlertCircle } from "lucide-react";
import { CATEGORY_LABELS, type ImportResult } from "../_types/backup";

export function ImportResultDisplay({ result }: { result: ImportResult }) {
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
