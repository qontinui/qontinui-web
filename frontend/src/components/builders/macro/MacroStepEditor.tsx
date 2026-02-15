"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, ChevronUp, ChevronDown, MousePointerClick, Type, Command, ArrowRight, Clock, ArrowUpDown, GripVertical } from "lucide-react";
import type { MacroStep } from "@/services/library-service";

const ACTION_TYPES = [
  { value: "CLICK", label: "Click", icon: MousePointerClick, color: "text-blue-400" },
  { value: "TYPE", label: "Type", icon: Type, color: "text-green-400" },
  { value: "HOTKEY", label: "Hotkey", icon: Command, color: "text-amber-400" },
  { value: "GO_TO_STATE", label: "Go to State", icon: ArrowRight, color: "text-violet-400" },
  { value: "WAIT", label: "Wait", icon: Clock, color: "text-gray-400" },
  { value: "SCROLL", label: "Scroll", icon: ArrowUpDown, color: "text-cyan-400" },
] as const;

interface MacroStepEditorProps {
  steps: MacroStep[];
  onChange: (steps: MacroStep[]) => void;
}

function createEmptyStep(): MacroStep {
  return {
    action_type: "CLICK",
    name: "",
    pause_after_ms: 500,
  };
}

export function MacroStepEditor({ steps, onChange }: MacroStepEditorProps) {
  const addStep = () => {
    onChange([...steps, createEmptyStep()]);
  };

  const removeStep = (index: number) => {
    onChange(steps.filter((_, i) => i !== index));
  };

  const updateStep = (index: number, updates: Partial<MacroStep>) => {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  };

  const moveStep = (index: number, direction: "up" | "down") => {
    const newSteps = [...steps];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSteps.length) return;
    const temp = newSteps[index]!;
    newSteps[index] = newSteps[targetIndex]!;
    newSteps[targetIndex] = temp;
    onChange(newSteps);
  };

  const actionInfo = (type: string) =>
    ACTION_TYPES.find((a) => a.value === type) ?? ACTION_TYPES[0];

  return (
    <div className="space-y-2">
      {steps.length === 0 && (
        <p className="text-xs text-text-muted py-3 text-center">
          No steps yet. Add steps to define the macro sequence.
        </p>
      )}

      {steps.map((step, index) => {
        const info = actionInfo(step.action_type);
        const Icon = info.icon;

        return (
          <div
            key={index}
            className="border border-border-subtle/50 rounded-lg bg-surface-canvas/30 p-3 space-y-2"
          >
            {/* Step Header */}
            <div className="flex items-center gap-2">
              <GripVertical className="size-3.5 text-text-muted/50 shrink-0 cursor-grab" />
              <Badge variant="outline" className="text-[10px] tabular-nums">
                {index + 1}
              </Badge>
              <Icon className={`size-3.5 ${info.color}`} />

              <Select
                value={step.action_type}
                onValueChange={(val) => updateStep(index, { action_type: val })}
              >
                <SelectTrigger className="h-7 w-32 text-xs bg-surface-raised/50 border-border-subtle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map((a) => (
                    <SelectItem key={a.value} value={a.value} className="text-xs">
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                value={step.name ?? ""}
                onChange={(e) => updateStep(index, { name: e.target.value })}
                placeholder="Step name (optional)"
                className="h-7 text-xs flex-1 bg-surface-raised/50 border-border-subtle"
              />

              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => moveStep(index, "up")}
                  disabled={index === 0}
                >
                  <ChevronUp className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => moveStep(index, "down")}
                  disabled={index === steps.length - 1}
                >
                  <ChevronDown className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                  onClick={() => removeStep(index)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>

            {/* Action-specific fields */}
            <div className="pl-8 space-y-2">
              {(step.action_type === "CLICK" || step.action_type === "TYPE") && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-text-muted w-20 shrink-0">
                    Target Images
                  </label>
                  <Input
                    value={step.target_image_names?.join(", ") ?? ""}
                    onChange={(e) =>
                      updateStep(index, {
                        target_image_names: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="Image names (comma-separated)"
                    className="h-7 text-xs bg-surface-raised/50 border-border-subtle"
                  />
                </div>
              )}

              {step.action_type === "TYPE" && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-text-muted w-20 shrink-0">
                    Text Input
                  </label>
                  <Input
                    value={step.text_input ?? ""}
                    onChange={(e) => updateStep(index, { text_input: e.target.value })}
                    placeholder="Text to type..."
                    className="h-7 text-xs bg-surface-raised/50 border-border-subtle"
                  />
                </div>
              )}

              {step.action_type === "HOTKEY" && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-text-muted w-20 shrink-0">
                    Hotkey
                  </label>
                  <Input
                    value={step.hotkey ?? ""}
                    onChange={(e) => updateStep(index, { hotkey: e.target.value })}
                    placeholder="e.g. ctrl+s, alt+f4"
                    className="h-7 text-xs bg-surface-raised/50 border-border-subtle"
                  />
                </div>
              )}

              {step.action_type === "GO_TO_STATE" && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-text-muted w-20 shrink-0">
                    Target States
                  </label>
                  <Input
                    value={step.target_state_names?.join(", ") ?? ""}
                    onChange={(e) =>
                      updateStep(index, {
                        target_state_names: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="State names (comma-separated)"
                    className="h-7 text-xs bg-surface-raised/50 border-border-subtle"
                  />
                </div>
              )}

              {step.action_type === "SCROLL" && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-text-muted w-20 shrink-0">
                    Direction
                  </label>
                  <Select
                    value={(step as unknown as Record<string, unknown>).scroll_direction as string ?? "down"}
                    onValueChange={(val) => updateStep(index, { scroll_direction: val } as unknown as Partial<MacroStep>)}
                  >
                    <SelectTrigger className="h-7 w-32 text-xs bg-surface-raised/50 border-border-subtle">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="up" className="text-xs">Up</SelectItem>
                      <SelectItem value="down" className="text-xs">Down</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="text-[10px] text-text-muted w-14 shrink-0 ml-2">
                    Amount
                  </label>
                  <Input
                    type="number"
                    value={(step as unknown as Record<string, unknown>).scroll_amount as number ?? 3}
                    onChange={(e) => updateStep(index, { scroll_amount: Number(e.target.value) } as unknown as Partial<MacroStep>)}
                    className="h-7 text-xs w-20 bg-surface-raised/50 border-border-subtle"
                  />
                </div>
              )}

              {/* Pause after - shown for all types */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-text-muted w-20 shrink-0">
                  Pause After
                </label>
                <Input
                  type="number"
                  value={step.pause_after_ms ?? 500}
                  onChange={(e) =>
                    updateStep(index, { pause_after_ms: Number(e.target.value) })
                  }
                  className="h-7 text-xs w-24 bg-surface-raised/50 border-border-subtle"
                />
                <span className="text-[10px] text-text-muted">ms</span>
              </div>

              {step.action_type !== "WAIT" && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-text-muted w-20 shrink-0">
                    Timeout
                  </label>
                  <Input
                    type="number"
                    value={step.timeout_seconds ?? 30}
                    onChange={(e) =>
                      updateStep(index, { timeout_seconds: Number(e.target.value) })
                    }
                    className="h-7 text-xs w-24 bg-surface-raised/50 border-border-subtle"
                  />
                  <span className="text-[10px] text-text-muted">seconds</span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <Button
        variant="ghost"
        size="sm"
        className="h-8 text-xs text-text-muted hover:text-text-secondary gap-1.5 w-full border border-dashed border-border-subtle/50"
        onClick={addStep}
      >
        <Plus className="size-3.5" />
        Add Step
      </Button>
    </div>
  );
}
