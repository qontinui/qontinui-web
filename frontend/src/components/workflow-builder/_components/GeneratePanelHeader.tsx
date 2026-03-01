"use client";

import React from "react";
import { Sparkles, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SubmittingAction } from "../ai-generate-types";

interface GeneratePanelHeaderProps {
  onCreateManually: () => void;
  isCreatingManually: boolean;
  submittingAction: SubmittingAction;
}

export function GeneratePanelHeader({
  onCreateManually,
  isCreatingManually,
  submittingAction,
}: GeneratePanelHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-semibold text-zinc-200">
          Generate Workflow with AI
        </h2>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-zinc-400"
        onClick={onCreateManually}
        disabled={isCreatingManually || submittingAction !== null}
      >
        {isCreatingManually ? (
          <Loader2 className="size-3 animate-spin mr-1" />
        ) : (
          <Plus className="size-3 mr-1" />
        )}
        Create Manually
      </Button>
    </div>
  );
}
