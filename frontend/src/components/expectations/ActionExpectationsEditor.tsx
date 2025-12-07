"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Camera } from "lucide-react";
import type { ActionExpectations } from "@/lib/expectations/types";

interface ActionExpectationsEditorProps {
  expectations: ActionExpectations | undefined;
  onChange: (expectations: ActionExpectations) => void;
}

/**
 * Editor for per-action expectation settings
 *
 * Compact design suitable for the action properties sidebar.
 * Provides controls for:
 * - Terminal on failure behavior
 * - Checkpoint capture settings
 * - Retry configuration
 */
export function ActionExpectationsEditor({
  expectations,
  onChange,
}: ActionExpectationsEditorProps) {
  const current = expectations || {};

  const updateField = <K extends keyof ActionExpectations>(
    field: K,
    value: ActionExpectations[K]
  ) => {
    onChange({
      ...current,
      [field]: value,
    });
  };

  return (
    <Card className="border-gray-700 bg-[#27272A]/50 p-4">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2 text-[#00D9FF]">
          <Camera className="w-4 h-4" />
          <h4 className="text-sm font-medium">Action Expectations</h4>
        </div>

        {/* Terminal on Failure */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5 flex-1 pr-2">
            <Label className="text-xs text-gray-400">Terminal on Failure</Label>
            <p className="text-xs text-gray-500">
              Stop workflow if this action fails
            </p>
          </div>
          <Switch
            checked={current.is_terminal_on_failure ?? false}
            onCheckedChange={(checked) =>
              updateField("is_terminal_on_failure", checked)
            }
          />
        </div>

        {/* Checkpoint on Failure */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5 flex-1 pr-2">
            <Label className="text-xs text-gray-400">Capture on Failure</Label>
            <p className="text-xs text-gray-500">
              Capture checkpoint when action fails
            </p>
          </div>
          <Switch
            checked={current.capture_checkpoint_on_failure ?? false}
            onCheckedChange={(checked) =>
              updateField("capture_checkpoint_on_failure", checked)
            }
          />
        </div>

        {/* Checkpoint After Success */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1 pr-2">
              <Label className="text-xs text-gray-400">
                Capture After Action
              </Label>
              <p className="text-xs text-gray-500">
                Capture checkpoint after action completes
              </p>
            </div>
            <Switch
              checked={current.capture_checkpoint_after ?? false}
              onCheckedChange={(checked) =>
                updateField("capture_checkpoint_after", checked)
              }
            />
          </div>

          {/* Checkpoint Name (only shown if capture_checkpoint_after is true) */}
          {current.capture_checkpoint_after && (
            <div className="space-y-2 pl-4 border-l-2 border-gray-700">
              <Label className="text-xs text-gray-400">Checkpoint Name</Label>
              <Input
                type="text"
                placeholder="Enter checkpoint name"
                value={current.checkpoint_name || ""}
                onChange={(e) => updateField("checkpoint_name", e.target.value)}
                className="bg-transparent border-gray-700 text-sm"
              />
            </div>
          )}
        </div>

        {/* Retry Configuration */}
        <div className="pt-3 border-t border-gray-700 space-y-3">
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Max Retries</Label>
            <Input
              type="number"
              min="0"
              step="1"
              placeholder="0"
              value={current.max_retries ?? ""}
              onChange={(e) =>
                updateField(
                  "max_retries",
                  e.target.value ? parseInt(e.target.value) : undefined
                )
              }
              className="bg-transparent border-gray-700 text-sm"
            />
            <p className="text-xs text-gray-500">
              Number of times to retry on failure
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Retry Delay (ms)</Label>
            <Input
              type="number"
              min="0"
              step="100"
              placeholder="1000"
              value={current.retry_delay_ms ?? ""}
              onChange={(e) =>
                updateField(
                  "retry_delay_ms",
                  e.target.value ? parseInt(e.target.value) : undefined
                )
              }
              className="bg-transparent border-gray-700 text-sm"
            />
            <p className="text-xs text-gray-500">
              Delay between retry attempts
            </p>
          </div>
        </div>

        {/* Max Duration */}
        <div className="space-y-2 pt-3 border-t border-gray-700">
          <Label className="text-xs text-gray-400">Max Duration (ms)</Label>
          <Input
            type="number"
            min="0"
            step="100"
            placeholder="Inherit from global"
            value={current.max_duration_ms ?? ""}
            onChange={(e) =>
              updateField(
                "max_duration_ms",
                e.target.value ? parseInt(e.target.value) : undefined
              )
            }
            className="bg-transparent border-gray-700 text-sm"
          />
          <p className="text-xs text-gray-500">
            Override global max action duration
          </p>
        </div>

        {/* Expected State After */}
        <div className="space-y-2 pt-3 border-t border-gray-700">
          <Label className="text-xs text-gray-400">Expected State After</Label>
          <Input
            type="text"
            placeholder="State name"
            value={current.expected_state_after || ""}
            onChange={(e) =>
              updateField("expected_state_after", e.target.value)
            }
            className="bg-transparent border-gray-700 text-sm"
          />
          <p className="text-xs text-gray-500">
            State that should be active after this action
          </p>
        </div>
      </div>
    </Card>
  );
}
