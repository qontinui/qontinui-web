"use client";

import React from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { PromptStep, WorkflowPhase } from "@/types/unified-workflow";

interface PromptConfigProps {
  step: PromptStep;
  onUpdate: (updates: Record<string, unknown>) => void;
  phase: WorkflowPhase;
}

export function PromptConfig({ step, onUpdate }: PromptConfigProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Prompt Content
        </label>
        <Textarea
          className="min-h-[120px] bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="Enter your prompt instructions..."
          value={step.content}
          onChange={(e) => onUpdate({ content: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Provider Override
          </label>
          <Input
            className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            placeholder="Default"
            value={step.provider ?? ""}
            onChange={(e) =>
              onUpdate({ provider: e.target.value || undefined })
            }
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Model Override
          </label>
          <Input
            className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            placeholder="Default"
            value={step.model ?? ""}
            onChange={(e) => onUpdate({ model: e.target.value || undefined })}
          />
        </div>
      </div>
      {step.is_summary_step && (
        <div className="p-3 bg-zinc-800/50 border border-zinc-700 rounded-md">
          <p className="text-xs text-zinc-500">
            This is the auto-generated summary step. It runs last in the
            completion phase and cannot be moved.
          </p>
        </div>
      )}
    </div>
  );
}
