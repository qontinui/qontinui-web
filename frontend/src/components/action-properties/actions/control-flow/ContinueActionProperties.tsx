"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { ActionPropertiesComponentProps } from "../../types";
import { TimingProperties } from "../../TimingProperties";
import { ConditionEditor } from "../../shared";
import { ContinueActionConfig } from "@/lib/action-schema";

/**
 * Properties component for CONTINUE action.
 *
 * Allows users to:
 * - Optionally specify a condition (only continue if condition is true)
 * - Add a message to log when continuing
 */
export function ContinueActionProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const config = action.config as ContinueActionConfig;

  return (
    <>
      {/* Optional Condition */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-text-muted">
            Continue Condition (Optional)
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
              title="Remove condition (always continue)"
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
            />
          </div>
        )}

        {!config.condition && (
          <p className="text-xs text-text-muted">
            Without a condition, the loop will always skip to the next iteration
            when this action executes.
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
          placeholder="e.g., Skipping due to invalid data"
          className="bg-transparent border-border-default"
        />
        <p className="text-xs text-text-muted">
          Optional message to log when the continue occurs.
        </p>
      </div>

      {/* Timing Properties */}
      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
