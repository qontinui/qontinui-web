import React from "react";
import { CheckCircle2 } from "lucide-react";
import type { CleanupResult } from "@/services/project-optimization/reference-cleaner";

interface CleanupReportProps {
  result: CleanupResult;
}

export function CleanupReport({ result }: CleanupReportProps) {
  const totalCleaned =
    result.workflowConnectionsCleaned + result.transitionWorkflowsCleaned;

  return (
    <div className="bg-green-950/30 border border-green-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 text-green-400">
        <CheckCircle2 className="w-4 h-4" />
        <span className="text-sm font-medium">Issues Fixed Successfully</span>
      </div>

      {totalCleaned > 0 ? (
        <div className="space-y-2">
          <div className="text-sm text-green-300">
            <span className="font-medium">Summary:</span>
            <ul className="mt-1 ml-4 list-disc list-inside text-green-400/90">
              {result.workflowConnectionsCleaned > 0 && (
                <li>
                  Removed {result.workflowConnectionsCleaned} orphaned workflow
                  connection
                  {result.workflowConnectionsCleaned !== 1 ? "s" : ""}
                </li>
              )}
              {result.transitionWorkflowsCleaned > 0 && (
                <li>
                  Removed {result.transitionWorkflowsCleaned} orphaned
                  transition workflow reference
                  {result.transitionWorkflowsCleaned !== 1 ? "s" : ""}
                </li>
              )}
            </ul>
          </div>

          {result.details.length > 0 && (
            <div className="text-xs text-green-400/70 mt-2">
              <span className="font-medium">Details:</span>
              <ul className="mt-1 ml-4 space-y-0.5 max-h-32 overflow-y-auto">
                {result.details.slice(0, 10).map((detail, i) => (
                  <li key={i}>
                    {detail.type === "workflow-connection"
                      ? `Workflow "${detail.sourceName || detail.sourceId}": ${detail.reason}`
                      : `Transition "${detail.sourceId}": ${detail.reason}`}
                  </li>
                ))}
                {result.details.length > 10 && (
                  <li className="text-green-400/50">
                    ...and {result.details.length - 10} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-green-400/90">
          No issues were found. All references are valid.
        </p>
      )}
    </div>
  );
}
