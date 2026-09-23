"use client";

import React from "react";
import { Sparkles, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SubmittingAction } from "../ai-generate-types";

interface GeneratePanelFooterProps {
  canGenerate: boolean;
  /** Coord's reason no generation may start right now (null = allowed). */
  refusal?: string | null;
  submittingAction: SubmittingAction;
  isBatchMode: boolean;
  batchPageCount: number;
  onGenerate: () => void;
  onGenerateAndRun: () => void;
}

export function GeneratePanelFooter({
  canGenerate,
  refusal = null,
  submittingAction,
  isBatchMode,
  batchPageCount,
  onGenerate,
  onGenerateAndRun,
}: GeneratePanelFooterProps) {
  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/50 px-6 py-3 min-h-[60px]">
      <div className="max-w-3xl mx-auto flex items-center gap-3">
        <Button
          onClick={onGenerate}
          disabled={
            !canGenerate || submittingAction !== null || refusal !== null
          }
          title={refusal ?? undefined}
          className="px-6"
        >
          {submittingAction === "generate" ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4 mr-2" />
          )}
          {submittingAction === "generate"
            ? "Starting..."
            : isBatchMode
              ? `Generate (${batchPageCount} pages)`
              : "Generate"}
        </Button>
        <Button
          variant="outline"
          onClick={onGenerateAndRun}
          disabled={
            !canGenerate || submittingAction !== null || refusal !== null
          }
          title={refusal ?? undefined}
          className="px-6"
        >
          {submittingAction === "generate-and-run" ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Play className="w-4 h-4 mr-2" />
          )}
          {submittingAction === "generate-and-run"
            ? "Starting..."
            : isBatchMode
              ? `Generate & Run (${batchPageCount} pages)`
              : "Generate & Run"}
        </Button>
        {refusal && (
          <p
            className="text-xs text-text-muted"
            data-testid="workflow-generate-refusal"
          >
            {refusal}
          </p>
        )}
      </div>
    </div>
  );
}
