"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import type { ScriptStep } from "@/types/unified-workflow";

interface ScriptConfigProps {
  step: ScriptStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function ScriptConfig({ step, onUpdate }: ScriptConfigProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Target URL
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="https://example.com"
          value={step.target_url ?? ""}
          onChange={(e) =>
            onUpdate({ target_url: e.target.value || undefined })
          }
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Script ID (from library)
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="Select from library..."
          value={step.script_id ?? ""}
          onChange={(e) => onUpdate({ script_id: e.target.value || undefined })}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-400">
        <input
          type="checkbox"
          className="rounded"
          checked={step.refinement_enabled}
          onChange={(e) => onUpdate({ refinement_enabled: e.target.checked })}
        />
        Enable refinement loop (retry until success)
      </label>
    </div>
  );
}
