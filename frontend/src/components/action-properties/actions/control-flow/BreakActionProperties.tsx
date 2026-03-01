"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { ActionPropertiesComponentProps } from "../../types";
import { TimingProperties } from "../../TimingProperties";
import { ConditionEditor } from "../../shared";
import { BreakActionConfig } from "@/lib/action-schema";

const DEFAULT_IMAGES: ActionPropertiesComponentProps["images"] = [];
const DEFAULT_VARIABLE_NAMES: string[] = [];

/**
 * Properties component for BREAK action.
 *
 * Allows users to:
 * - Optionally specify a condition (only break if condition is true)
 * - Add a message to log when breaking
 */
export function BreakActionProperties({
  action,
  updateConfig,
  images = DEFAULT_IMAGES,
  variableNames = DEFAULT_VARIABLE_NAMES,
}: ActionPropertiesComponentProps) {
  const config = action.config as BreakActionConfig;

  return (
    <>
      {/* Optional Condition */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-text-muted">
            Break Condition (Optional)
          </Label>
          {!config.condition ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-brand-primary hover:text-brand-primary/80 hover:bg-brand-primary/10"
              onClick={() =>
                updateConfig("condition", {
                  type: "variable",
                  variableName: "",
                  operator: "==",
                  expectedValue: "",
                })
              }
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Condition
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-text-muted hover:text-red-400"
              onClick={() => updateConfig("condition", undefined)}
              title="Remove condition (always break)"
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>

        {config.condition && (
          <div className="p-3 bg-surface-raised/50 rounded-md border border-border-default">
            <ConditionEditor
              condition={config.condition}
              onChange={(condition) => updateConfig("condition", condition)}
              label=""
              allowEmpty={false}
              images={images.map((img) => ({ id: img.id, name: img.name }))}
              existingVariables={variableNames}
            />
          </div>
        )}

        {!config.condition && (
          <p className="text-xs text-text-muted">
            Without a condition, the loop will always break when this action
            executes.
          </p>
        )}
      </div>

      {/* Message */}
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Message (Optional)</Label>
        <Input
          type="text"
          value={config.message || ""}
          onChange={(e) => updateConfig("message", e.target.value || undefined)}
          placeholder="e.g., Breaking due to error"
          className="bg-transparent border-border-default"
        />
        <p className="text-xs text-text-muted">
          Optional message to log when the break occurs.
        </p>
      </div>

      {/* Timing Properties */}
      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
