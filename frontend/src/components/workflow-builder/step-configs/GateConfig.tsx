"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { GateStep, UnifiedWorkflow } from "@/types/unified-workflow";

interface GateConfigProps {
  step: GateStep;
  onUpdate: (updates: Record<string, unknown>) => void;
  workflow: UnifiedWorkflow;
}

export function GateConfig({ step, onUpdate, workflow }: GateConfigProps) {
  const availableSteps = workflow.verification_steps.filter(
    (s) => s.type !== "gate" && s.id !== step.id
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Description
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="What this gate controls"
          value={step.description ?? ""}
          onChange={(e) =>
            onUpdate({ description: e.target.value || undefined })
          }
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-2">
          Required Steps
        </label>
        <p className="text-xs text-zinc-500 mb-2">
          Select verification steps that must ALL pass for this gate to pass.
        </p>
        {availableSteps.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No other verification steps to gate on.
          </p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {availableSteps.map((vs) => {
              const isRequired = step.required_steps.includes(vs.id);
              return (
                <label
                  key={vs.id}
                  className="flex items-center gap-2 text-sm text-zinc-300"
                >
                  <Checkbox
                    checked={isRequired}
                    onCheckedChange={(checked) => {
                      const next = checked
                        ? [...step.required_steps, vs.id]
                        : step.required_steps.filter((id) => id !== vs.id);
                      onUpdate({ required_steps: next });
                    }}
                  />
                  {vs.name}{" "}
                  <span className="text-xs text-zinc-500">({vs.type})</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-400">
        <input
          type="checkbox"
          className="rounded"
          checked={step.stop_on_failure ?? false}
          onChange={(e) => onUpdate({ stop_on_failure: e.target.checked })}
        />
        Stop remaining steps when gate fails
      </label>
    </div>
  );
}
