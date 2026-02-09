"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import type { MacroRefStep } from "@/types/unified-workflow";

interface MacroRefConfigProps {
  step: MacroRefStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function MacroRefConfig({ step, onUpdate }: MacroRefConfigProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Macro Name
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="Macro name"
          value={step.macro_name ?? ""}
          onChange={(e) =>
            onUpdate({ macro_name: e.target.value || undefined })
          }
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Macro ID
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="Select from library..."
          value={step.macro_id}
          onChange={(e) => onUpdate({ macro_id: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Monitor Index
        </label>
        <Input
          type="number"
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="0 = primary"
          value={step.monitor_index ?? ""}
          onChange={(e) =>
            onUpdate({
              monitor_index: e.target.value
                ? parseInt(e.target.value)
                : undefined,
            })
          }
        />
      </div>
    </div>
  );
}
