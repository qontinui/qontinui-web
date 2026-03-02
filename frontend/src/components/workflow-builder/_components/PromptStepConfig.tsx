import React from "react";
import type { PromptStep, WorkflowPhase } from "@/types/unified-workflow";
import type { StepUpdateHandler } from "./step-config-types";

export function PromptStepConfig({
  step,
  onUpdate,
}: {
  step: PromptStep;
  onUpdate: StepUpdateHandler;
  phase: WorkflowPhase;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="block text-xs font-medium text-zinc-400 mb-1">
          Prompt Content
        </p>
        <textarea
          value={step.content ?? ""}
          onChange={(e) => onUpdate({ content: e.target.value })}
          placeholder="Enter the prompt for the AI agent..."
          rows={12}
          className="w-full px-3 py-1.5 font-mono bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50 resize-y"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="block text-xs font-medium text-zinc-400 mb-1">
            Provider (optional)
          </p>
          <select
            value={step.provider ?? ""}
            onChange={(e) =>
              onUpdate({ provider: e.target.value || undefined })
            }
            className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">Default</option>
            <option value="claude_cli">Claude CLI</option>
            <option value="gemini_api">Gemini API</option>
          </select>
        </div>
        <div>
          <p className="block text-xs font-medium text-zinc-400 mb-1">
            Model (optional)
          </p>
          <select
            value={step.model ?? ""}
            onChange={(e) => onUpdate({ model: e.target.value || undefined })}
            className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">Default</option>
            <option value="claude-sonnet-4">Claude Sonnet 4</option>
            <option value="claude-opus-4">Claude Opus 4</option>
          </select>
        </div>
      </div>
    </div>
  );
}
