"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, Copy } from "lucide-react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GenerationPhaseProps } from "../_types/orchestrator-types";
import { TestStepsPreview } from "./TestStepsPreview";

export function GenerationPhase({
  generatedTest,
  generating,
  testType,
  onCopyCode,
}: GenerationPhaseProps) {
  const [showCode, setShowCode] = useState(true);

  if (generating) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
        <Loader2 className="size-10 text-purple-400 animate-spin mb-4" />
        <p className="text-sm text-text-primary font-medium">
          AI is generating test code...
        </p>
        <p className="text-xs text-text-muted mt-2">
          Creating {testType.replace("_", " ")} from execution results
        </p>
      </div>
    );
  }

  if (!generatedTest) return null;

  return (
    <div className="p-4 space-y-4">
      {/* Success header */}
      <div className="flex items-center gap-2">
        <div className="size-6 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <Check className="size-3.5 text-emerald-400" />
        </div>
        <span className="text-sm font-medium text-emerald-400">
          Test Generated Successfully
        </span>
      </div>

      {/* Test info */}
      <div className="p-3 rounded-md bg-surface-canvas/50 border border-border-subtle/50">
        <div className="text-sm font-medium text-text-primary">
          {generatedTest.name}
        </div>
        <div className="text-xs text-text-muted mt-1">
          {generatedTest.description}
        </div>
      </div>

      {/* AI Explanation */}
      <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-md">
        <div className="text-xs font-medium text-purple-400 uppercase tracking-wider mb-1">
          AI Explanation
        </div>
        <p className="text-sm text-text-secondary">
          {generatedTest.explanation}
        </p>
      </div>

      {/* Test Steps Preview */}
      {generatedTest.steps.length > 0 && (
        <TestStepsPreview steps={generatedTest.steps} />
      )}

      {/* Code preview */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowCode(!showCode)}
            className="flex items-center gap-1.5 text-xs font-medium text-text-muted uppercase tracking-wider hover:text-text-secondary"
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                !showCode && "-rotate-90"
              )}
            />
            Generated Code
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCopyCode}
            className="gap-1.5 h-6 text-xs text-text-muted"
          >
            <Copy className="size-3" />
            Copy
          </Button>
        </div>
        {showCode && (
          <pre className="p-3 bg-surface-canvas/80 rounded-md border border-border-subtle/50 text-xs text-text-secondary font-mono overflow-auto max-h-72 whitespace-pre-wrap">
            {generatedTest.code}
          </pre>
        )}
      </div>
    </div>
  );
}
