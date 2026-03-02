"use client";

import { CheckCircle2, AlertCircle } from "lucide-react";
import type { FileImportResult } from "../_hooks/batch-import-types";

interface BatchImportSummaryProps {
  results: FileImportResult[];
  importing: boolean;
  completedCount: number;
  errorCount: number;
}

export function BatchImportSummary({
  results,
  importing,
  completedCount,
  errorCount,
}: BatchImportSummaryProps) {
  if (results.length === 0 || importing) return null;

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-surface-canvas border border-border-subtle">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <span className="text-sm">{completedCount} succeeded</span>
      </div>
      {errorCount > 0 && (
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <span className="text-sm">{errorCount} failed</span>
        </div>
      )}
      <div className="flex-1" />
      <span className="text-sm text-muted-foreground">
        {results.reduce((sum, r) => sum + (r.elementCount || 0), 0)} total
        elements
      </span>
    </div>
  );
}
