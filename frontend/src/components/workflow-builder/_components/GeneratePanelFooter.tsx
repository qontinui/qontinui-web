"use client";

import React from "react";
import { Sparkles, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SubmittingAction } from "../ai-generate-types";

interface GeneratePanelFooterProps {
  canGenerate: boolean;
  submittingAction: SubmittingAction;
  isBatchMode: boolean;
  batchPageCount: number;
  onGenerate: () => void;
  onGenerateAndRun: () => void;
}

export function GeneratePanelFooter({
  canGenerate,
  submittingAction,
  isBatchMode,
  batchPageCount,
  onGenerate,
  onGenerateAndRun,
}: GeneratePanelFooterProps) {
  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/50 px-6 py-3">
      <div className="max-w-3xl mx-auto flex items-center gap-3">
        <Button
          onClick={onGenerate}
          disabled={!canGenerate || submittingAction !== null}
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
          disabled={!canGenerate || submittingAction !== null}
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
      </div>
    </div>
  );
}
