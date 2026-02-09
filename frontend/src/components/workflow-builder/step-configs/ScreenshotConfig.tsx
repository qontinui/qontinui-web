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
import type { ScreenshotStep } from "@/types/unified-workflow";

interface ScreenshotConfigProps {
  step: ScreenshotStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function ScreenshotConfig({ step, onUpdate }: ScreenshotConfigProps) {
  const monitorValue =
    step.monitor !== undefined ? String(step.monitor) : "all";

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Monitor
        </label>
        <Select
          value={monitorValue}
          onValueChange={(v) =>
            onUpdate({ monitor: v === "all" ? undefined : v })
          }
        >
          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Monitors</SelectItem>
            <SelectItem value="primary">Primary</SelectItem>
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="right">Right</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Delay Before Capture (ms)
        </label>
        <Input
          type="number"
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="0"
          value={step.delay_ms ?? ""}
          onChange={(e) =>
            onUpdate({
              delay_ms: e.target.value ? parseInt(e.target.value) : undefined,
            })
          }
        />
      </div>
    </div>
  );
}
