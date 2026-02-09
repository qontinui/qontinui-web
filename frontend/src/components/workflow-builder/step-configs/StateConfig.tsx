"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import type { StateStep } from "@/types/unified-workflow";

interface StateConfigProps {
  step: StateStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function StateConfig({ step, onUpdate }: StateConfigProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          State Name
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="State name"
          value={step.state_name ?? ""}
          onChange={(e) =>
            onUpdate({ state_name: e.target.value || undefined })
          }
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          State ID
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="Select from library..."
          value={step.state_id}
          onChange={(e) => onUpdate({ state_id: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Timeout (seconds)
        </label>
        <Input
          type="number"
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          value={step.timeout_seconds ?? 30}
          onChange={(e) =>
            onUpdate({ timeout_seconds: parseInt(e.target.value) || undefined })
          }
        />
      </div>
    </div>
  );
}
