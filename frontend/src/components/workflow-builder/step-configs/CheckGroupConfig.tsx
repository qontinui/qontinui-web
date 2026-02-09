"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import type { CheckGroupStep } from "@/types/unified-workflow";

interface CheckGroupConfigProps {
  step: CheckGroupStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function CheckGroupConfig({ step, onUpdate }: CheckGroupConfigProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Check Group ID
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="Select from library..."
          value={step.check_group_id}
          onChange={(e) => onUpdate({ check_group_id: e.target.value })}
        />
        <p className="text-xs text-zinc-500 mt-1">
          Runs all checks in the selected group.
        </p>
      </div>
    </div>
  );
}
