import type { BackupSummary } from "@/lib/runner-api";
import { Button } from "@/components/ui/button";
import { Database, RefreshCw } from "lucide-react";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "../_types/backup";

export function DataSummaryCard({
  summary,
  onRefresh,
}: {
  summary: BackupSummary | null;
  onRefresh: () => void;
}) {
  return (
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
            onClick={onRefresh}
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
  );
}
