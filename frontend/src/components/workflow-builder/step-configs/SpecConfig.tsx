"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SpecStep } from "@/types/unified-workflow";

interface SpecConfigProps {
  step: SpecStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function SpecConfig({ step, onUpdate }: SpecConfigProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Element Source
        </label>
        <Select
          value={step.element_source}
          onValueChange={(v) => onUpdate({ element_source: v })}
        >
          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="control">Control (Runner UI)</SelectItem>
            <SelectItem value="external">External (Browser Tab)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Description
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="What this spec verifies"
          value={step.description ?? ""}
          onChange={(e) =>
            onUpdate({ description: e.target.value || undefined })
          }
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-400">
        <input
          type="checkbox"
          className="rounded"
          checked={step.stop_on_failure ?? false}
          onChange={(e) => onUpdate({ stop_on_failure: e.target.checked })}
        />
        Stop on failure
      </label>
      <div className="p-3 bg-zinc-800/50 border border-zinc-700 rounded-md">
        <p className="text-xs text-zinc-500">
          Spec group assertions are configured via the Spec Builder UI.
        </p>
      </div>
    </div>
  );
}
