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
import type { GuiActionStep, GuiActionType } from "@/types/unified-workflow";
import { GUI_ACTION_TYPES } from "@/types/unified-workflow";

interface GuiActionConfigProps {
  step: GuiActionStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function GuiActionConfig({ step, onUpdate }: GuiActionConfigProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Action Type
        </label>
        <Select
          value={step.action}
          onValueChange={(v: GuiActionType) => onUpdate({ action: v })}
        >
          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GUI_ACTION_TYPES.map((a) => (
              <SelectItem key={a.type} value={a.type}>
                {a.label} - {a.description}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(step.action === "click" ||
        step.action === "double_click" ||
        step.action === "right_click") && (
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Target Images
          </label>
          <Input
            className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            placeholder="Image names (comma separated)"
            value={step.target_image_names?.join(", ") ?? ""}
            onChange={(e) =>
              onUpdate({
                target_image_names: e.target.value
                  ? e.target.value.split(",").map((s) => s.trim())
                  : undefined,
              })
            }
          />
        </div>
      )}

      {step.action === "type" && (
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Text to Type
          </label>
          <Input
            className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            placeholder="Enter text..."
            value={step.text_input ?? ""}
            onChange={(e) => onUpdate({ text_input: e.target.value })}
          />
        </div>
      )}

      {step.action === "hotkey" && (
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Hotkey Combination
          </label>
          <Input
            className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            placeholder="e.g., ctrl+s"
            value={step.hotkey ?? ""}
            onChange={(e) => onUpdate({ hotkey: e.target.value })}
          />
        </div>
      )}

      {step.action === "scroll" && (
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Scroll Direction
          </label>
          <Select
            value={step.scroll_direction ?? "down"}
            onValueChange={(v) => onUpdate({ scroll_direction: v })}
          >
            <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="up">Up</SelectItem>
              <SelectItem value="down">Down</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Pause After (ms)
          </label>
          <Input
            type="number"
            className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            value={step.pause_after_ms ?? ""}
            onChange={(e) =>
              onUpdate({
                pause_after_ms: e.target.value
                  ? parseInt(e.target.value)
                  : undefined,
              })
            }
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
    </div>
  );
}
