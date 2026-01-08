"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { Settings } from "lucide-react";
import type { GlobalExpectations } from "@/lib/expectations/types";

interface GlobalExpectationsEditorProps {
  expectations: GlobalExpectations | undefined;
  onChange: (expectations: GlobalExpectations) => void;
}

/**
 * Editor for workflow-level global expectations
 *
 * Provides controls for:
 * - Console error detection
 * - Network error detection
 * - Action duration limits
 * - Total workflow duration limits
 * - Pattern matching confidence thresholds
 */
export function GlobalExpectationsEditor({
  expectations,
  onChange,
}: GlobalExpectationsEditorProps) {
  const current = expectations || {};

  const updateField = <K extends keyof GlobalExpectations>(
    field: K,
    value: GlobalExpectations[K]
  ) => {
    onChange({
      ...current,
      [field]: value,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 text-brand-primary">
        <Settings className="w-4 h-4" />
        <h3 className="text-sm font-medium">Global Expectations</h3>
      </div>

      {/* Error Detection */}
      <Card className="p-4 border-border-default bg-surface-raised/50 space-y-4">
        <h4 className="text-xs font-medium text-text-secondary">
          Error Detection
        </h4>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-xs text-text-muted">No Console Errors</Label>
            <p className="text-xs text-text-muted">
              Fail if console errors are detected
            </p>
          </div>
          <Switch
            checked={current.no_console_errors ?? false}
            onCheckedChange={(checked) =>
              updateField("no_console_errors", checked)
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-xs text-text-muted">No Network Errors</Label>
            <p className="text-xs text-text-muted">
              Fail if network errors are detected
            </p>
          </div>
          <Switch
            checked={current.no_network_errors ?? false}
            onCheckedChange={(checked) =>
              updateField("no_network_errors", checked)
            }
          />
        </div>
      </Card>

      {/* Timing Limits */}
      <Card className="p-4 border-border-default bg-surface-raised/50 space-y-4">
        <h4 className="text-xs font-medium text-text-secondary">
          Timing Limits
        </h4>

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">
            Max Action Duration (ms)
          </Label>
          <Input
            type="number"
            min="0"
            step="100"
            placeholder="10000"
            value={current.max_action_duration_ms ?? ""}
            onChange={(e) =>
              updateField(
                "max_action_duration_ms",
                e.target.value ? parseInt(e.target.value) : undefined
              )
            }
            className="bg-transparent border-border-default text-sm"
          />
          <p className="text-xs text-text-muted">
            Maximum time allowed for a single action (default: 10000ms)
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">
            Max Total Duration (ms)
          </Label>
          <Input
            type="number"
            min="0"
            step="1000"
            placeholder="300000"
            value={current.max_total_duration_ms ?? ""}
            onChange={(e) =>
              updateField(
                "max_total_duration_ms",
                e.target.value ? parseInt(e.target.value) : undefined
              )
            }
            className="bg-transparent border-border-default text-sm"
          />
          <p className="text-xs text-text-muted">
            Maximum total workflow execution time (default: 300000ms / 5min)
          </p>
        </div>
      </Card>

      {/* Pattern Matching */}
      <Card className="p-4 border-border-default bg-surface-raised/50 space-y-4">
        <h4 className="text-xs font-medium text-text-secondary">
          Pattern Matching
        </h4>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-xs text-text-muted">
              Allow Partial Matches
            </Label>
            <p className="text-xs text-text-muted">
              Accept matches below confidence threshold
            </p>
          </div>
          <Switch
            checked={current.allow_partial_matches ?? true}
            onCheckedChange={(checked) =>
              updateField("allow_partial_matches", checked)
            }
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-text-muted">
              Minimum Confidence Threshold
            </Label>
            <span className="text-xs text-text-secondary font-mono">
              {(current.min_confidence_threshold ?? 0.8).toFixed(2)}
            </span>
          </div>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={[current.min_confidence_threshold ?? 0.8]}
            onValueChange={([value]) =>
              updateField("min_confidence_threshold", value)
            }
            className="w-full"
          />
          <p className="text-xs text-text-muted">
            Minimum confidence threshold for pattern matching (0.0 - 1.0)
          </p>
        </div>
      </Card>
    </div>
  );
}
