"use client";

import { XCircle } from "lucide-react";
import type { FailureInfo } from "@/lib/runner-api";

// =============================================================================
// FailureSection (matches runner's FailureSection component)
// =============================================================================

export function FailureSection({ failure }: { failure: FailureInfo }) {
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-3">
        <XCircle className="size-5 text-red-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-red-500">Run Failed</h3>
          <p className="text-sm text-red-400 mt-1">{failure.reason}</p>
        </div>
      </div>

      {failure.failed_step && (
        <div className="ml-8 text-sm">
          <span className="text-text-muted">Failed at: </span>
          <span className="text-red-400 font-medium">
            {failure.failed_step}
          </span>
        </div>
      )}

      {failure.error_type && (
        <div className="ml-8 text-sm">
          <span className="text-text-muted">Error type: </span>
          <span className="text-red-400">{failure.error_type}</span>
        </div>
      )}

      {failure.error_details && failure.error_details !== failure.reason && (
        <div className="ml-8 mt-2">
          <details className="text-sm">
            <summary className="cursor-pointer text-text-muted hover:text-text-primary">
              Show error details
            </summary>
            <pre className="mt-2 p-3 bg-surface-canvas/50 rounded text-xs overflow-x-auto whitespace-pre-wrap text-red-300">
              {failure.error_details}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
