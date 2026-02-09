"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import type { WorkflowRefStep } from "@/types/unified-workflow";

interface WorkflowRefConfigProps {
  step: WorkflowRefStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function WorkflowRefConfig({ step, onUpdate }: WorkflowRefConfigProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Workflow Name
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="Workflow name"
          value={step.workflow_name ?? ""}
          onChange={(e) =>
            onUpdate({ workflow_name: e.target.value || undefined })
          }
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Workflow ID
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="Select from library..."
          value={step.workflow_id}
          onChange={(e) => onUpdate({ workflow_id: e.target.value })}
        />
      </div>
      {step.phase !== "setup" && (
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
