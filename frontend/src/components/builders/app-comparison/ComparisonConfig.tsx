"use client";

import { Layers, Eye, GitCompare } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ComparisonConfigState } from "./AppComparisonWizard";

interface ComparisonConfigProps {
  config: ComparisonConfigState;
  onChange: (config: ComparisonConfigState) => void;
}

const MODES: {
  value: ComparisonConfigState["mode"];
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "structural",
    label: "Structural",
    description:
      "Compare DOM structure, element hierarchy, and component tree differences",
    icon: <Layers className="size-5" />,
  },
  {
    value: "visual",
    label: "Visual",
    description:
      "Compare visual layout, styling, spacing, and visual element positions",
    icon: <Eye className="size-5" />,
  },
  {
    value: "both",
    label: "Both",
    description:
      "Comprehensive comparison combining structural and visual analysis",
    icon: <GitCompare className="size-5" />,
  },
];

export function ComparisonConfig({ config, onChange }: ComparisonConfigProps) {
  const update = (patch: Partial<ComparisonConfigState>) => {
    onChange({ ...config, ...patch });
  };

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      {/* Routes */}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-sm text-text-secondary">Reference Route</Label>
          <Input
            value={config.refRoute}
            onChange={(e) => update({ refRoute: e.target.value })}
            placeholder="/dashboard"
            className="bg-surface-raised/50 border-border-subtle text-sm"
          />
          <p className="text-[10px] text-text-muted">
            Route path in the reference app to compare
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm text-text-secondary">Target Route</Label>
          <Input
            value={config.targetRoute}
            onChange={(e) => update({ targetRoute: e.target.value })}
            placeholder="/dashboard"
            className="bg-surface-raised/50 border-border-subtle text-sm"
          />
          <p className="text-[10px] text-text-muted">
            Route path in the target app to compare
          </p>
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label className="text-sm text-text-secondary">
          Description{" "}
          <span className="text-text-muted text-xs">(optional)</span>
        </Label>
        <Textarea
          value={config.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="Additional context for AI comparison (e.g., 'Focus on the header navigation and sidebar layout')..."
          rows={3}
          className="bg-surface-raised/50 border-border-subtle text-sm resize-none"
        />
      </div>

      {/* Comparison Mode */}
      <div className="space-y-3">
        <Label className="text-sm text-text-secondary">Comparison Mode</Label>
        <div className="space-y-2">
          {MODES.map((mode) => (
            <label
              key={mode.value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                config.mode === mode.value
                  ? "border-cyan-500/50 bg-cyan-500/5"
                  : "border-border-subtle hover:border-border-default"
              }`}
            >
              <input
                type="radio"
                name="comparison-mode"
                value={mode.value}
                checked={config.mode === mode.value}
                onChange={() => update({ mode: mode.value })}
                className="mt-1 accent-cyan-500"
              />
              <div
                className={`mt-0.5 ${config.mode === mode.value ? "text-cyan-400" : "text-text-muted"}`}
              >
                {mode.icon}
              </div>
              <div>
                <div
                  className={`text-sm font-medium ${config.mode === mode.value ? "text-cyan-400" : "text-text-primary"}`}
                >
                  {mode.label}
                </div>
                <p className="text-xs text-text-muted mt-0.5">
                  {mode.description}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
