"use client";

import React from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { ShellCommandStep, WorkflowPhase } from "@/types/unified-workflow";

interface ShellCommandConfigProps {
  step: ShellCommandStep;
  onUpdate: (updates: Record<string, unknown>) => void;
  phase: WorkflowPhase;
}

export function ShellCommandConfig({
  step,
  onUpdate,
}: ShellCommandConfigProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Command
        </label>
        <Textarea
          className="min-h-[80px] font-mono bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="e.g., git status"
          value={step.command}
          onChange={(e) => onUpdate({ command: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Working Directory
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="Relative to project root"
          value={step.working_directory ?? ""}
          onChange={(e) =>
            onUpdate({ working_directory: e.target.value || undefined })
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Timeout (seconds)
          </label>
          <Input
            type="number"
            className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            value={step.timeout_seconds ?? 60}
            onChange={(e) =>
              onUpdate({
                timeout_seconds: parseInt(e.target.value) || undefined,
              })
            }
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              className="rounded"
              checked={step.fail_on_error !== false}
              onChange={(e) => onUpdate({ fail_on_error: e.target.checked })}
            />
            Fail on error
          </label>
        </div>
      </div>
      {step.phase === "setup" && (
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            className="rounded"
            checked={step.run_on_subsequent_iterations ?? false}
            onChange={(e) =>
              onUpdate({ run_on_subsequent_iterations: e.target.checked })
            }
          />
          Run on subsequent iterations
        </label>
      )}
    </div>
  );
}
