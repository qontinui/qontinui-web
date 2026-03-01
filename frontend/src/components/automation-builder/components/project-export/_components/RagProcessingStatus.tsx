import React from "react";
import { Progress } from "@/components/ui/progress";
import { Brain, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { RAGSetupProgress } from "@/services/rag-setup-service";
import type { RagStatus } from "../project-export-types";

interface RagProcessingStatusProps {
  ragStatus: RagStatus;
  ragProgress: RAGSetupProgress | null;
  ragError: string | null;
}

const containerClassMap: Record<string, string> = {
  completed: "bg-green-950/30 border-green-700",
  failed: "bg-red-950/30 border-red-700",
  skipped: "bg-surface-canvas border-border-default",
};

const iconClassMap: Record<string, string> = {
  completed: "text-green-400",
  failed: "text-red-400",
  skipped: "text-text-muted",
};

export function RagProcessingStatus({
  ragStatus,
  ragProgress,
  ragError,
}: RagProcessingStatusProps) {
  if (ragStatus === "idle") return null;

  const containerClass =
    containerClassMap[ragStatus] ||
    "bg-brand-primary/10 border-brand-primary/30";
  const iconClass = iconClassMap[ragStatus] || "text-brand-primary";

  return (
    <div className={`rounded-lg p-4 space-y-3 border ${containerClass}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className={`w-4 h-4 ${iconClass}`} />
          <span className="font-medium text-white text-sm">RAG Processing</span>
        </div>
        {ragStatus === "checking" && (
          <span className="text-xs text-text-muted">Checking runner...</span>
        )}
        {ragStatus === "processing" && (
          <Loader2 className="w-4 h-4 animate-spin text-brand-primary" />
        )}
        {ragStatus === "completed" && (
          <CheckCircle2 className="w-4 h-4 text-green-400" />
        )}
        {ragStatus === "failed" && (
          <AlertCircle className="w-4 h-4 text-red-400" />
        )}
        {ragStatus === "skipped" && (
          <span className="text-xs text-text-muted">Skipped</span>
        )}
      </div>

      {ragStatus === "processing" && ragProgress && (
        <div className="space-y-2">
          <Progress value={ragProgress.percent || 0} className="h-2" />
          <div className="flex justify-between text-xs text-text-muted">
            <span>
              {ragProgress.currentElement || "Processing elements..."}
            </span>
            <span>
              {ragProgress.elementsProcessed}/{ragProgress.totalElements}
            </span>
          </div>
        </div>
      )}

      {ragStatus === "completed" && ragProgress && (
        <p className="text-sm text-green-400">
          {ragProgress.elementsProcessed} elements processed. RAG search is now
          available in the runner.
        </p>
      )}

      {ragStatus === "skipped" && (
        <p className="text-sm text-text-muted">
          RAG processing was skipped. Start qontinui-runner to enable semantic
          search.
        </p>
      )}

      {ragStatus === "failed" && ragError && (
        <p className="text-sm text-red-400">{ragError}</p>
      )}
    </div>
  );
}
