"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ActionPropertiesComponentProps } from "../../types";
import { TimingProperties } from "../../TimingProperties";
import { VariableSelector, ExpressionEditor } from "../../shared";
import { SetVariableActionConfig } from "@/lib/action-schema";

const DEFAULT_VARIABLE_NAMES: string[] = [];

/**
 * Properties component for SET_VARIABLE action.
 *
 * Allows users to:
 * - Specify a variable name to set
 * - Choose value source (direct value, expression, clipboard, etc.)
 * - Set the variable type hint
 * - Choose variable scope
 */
export function SetVariableActionProperties({
  action,
  updateConfig,
  variableNames = DEFAULT_VARIABLE_NAMES,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as SetVariableActionConfig;

  const valueSourceType = config.valueSource?.type || "direct";

  const handleValueSourceTypeChange = (type: string) => {
    if (type === "direct") {
      updateConfig("valueSource", undefined);
    } else {
      updateConfig("valueSource", {
        type,
        ...(type === "expression" && { expression: "" }),
      });
    }
  };

  return (
    <>
      {/* Variable Name */}
      <VariableSelector
        label="Variable Name"
        value={config.variableName || ""}
        onChange={(name) => updateConfig("variableName", name)}
        existingVariables={variableNames}
        placeholder="myVariable"
        required
      />
      <p className="text-xs text-text-muted -mt-1">
        Name of the variable to create or update. Use existing variable to
        update, or enter a new name to create.
      </p>

      {/* Value Source Type */}
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Value Source</Label>
        <Select
          value={valueSourceType}
          onValueChange={handleValueSourceTypeChange}
        >
          <SelectTrigger className="bg-transparent border-border-default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="direct">Direct Value</SelectItem>
            <SelectItem value="expression">JavaScript Expression</SelectItem>
            <SelectItem value="clipboard">From Clipboard</SelectItem>
            <SelectItem value="ocr">From Screen (OCR)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Direct Value Input */}
      {valueSourceType === "direct" && (
        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Value</Label>
          <Input
            type="text"
            value={
              config.value !== undefined ? JSON.stringify(config.value) : ""
            }
            onChange={(e) => {
              const val = e.target.value;
              // Try to parse as JSON, fallback to string
              try {
                const parsed = JSON.parse(val);
                updateConfig("value", parsed);
              } catch {
                updateConfig("value", val);
              }
            }}
            placeholder="Enter value (string, number, or JSON)"
            className="bg-transparent border-border-default font-mono text-sm"
          />
          <p className="text-xs text-text-muted">
            Enter a value. Numbers, booleans, and JSON objects/arrays are
            auto-detected.
          </p>
        </div>
      )}

      {/* Expression Input */}
      {valueSourceType === "expression" && (
        <ExpressionEditor
          label="Expression"
          value={config.valueSource?.expression || ""}
          onChange={(expr) =>
            updateConfig("valueSource", {
              ...config.valueSource,
              type: "expression",
              expression: expr,
            })
          }
          placeholder="e.g., count + 1, items.length, Date.now()"
          helperText="JavaScript expression. Can reference other variables by name."
          required
        />
      )}

      {/* Clipboard Source */}
      {valueSourceType === "clipboard" && (
        <div className="p-3 bg-surface-raised/50 rounded-md border border-border-default">
          <p className="text-sm text-text-muted">
            Variable will be set to the current clipboard contents when this
            action runs.
          </p>
        </div>
      )}

      {/* OCR Source - placeholder for future implementation */}
      {valueSourceType === "ocr" && (
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
          <p className="text-sm text-yellow-300 font-medium">Coming Soon</p>
          <p className="text-xs text-yellow-400 mt-1">
            OCR value extraction will be available in a future update. For now,
            use Direct Value or Expression.
          </p>
        </div>
      )}

      {/* Variable Type Hint */}
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Type Hint (Optional)</Label>
        <Select
          value={config.type || "auto"}
          onValueChange={(type) =>
            updateConfig("type", type === "auto" ? undefined : type)
          }
        >
          <SelectTrigger className="bg-transparent border-border-default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
            <SelectItem value="string">String</SelectItem>
            <SelectItem value="number">Number</SelectItem>
            <SelectItem value="boolean">Boolean</SelectItem>
            <SelectItem value="array">Array</SelectItem>
            <SelectItem value="object">Object</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-text-muted">
          Optional type hint for the variable value.
        </p>
      </div>

      {/* Variable Scope */}
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Scope</Label>
        <Select
          value={config.scope || "local"}
          onValueChange={(scope) =>
            updateConfig("scope", scope as SetVariableActionConfig["scope"])
          }
        >
          <SelectTrigger className="bg-transparent border-border-default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">
              Local (this workflow run only)
            </SelectItem>
            <SelectItem value="global">
              Global (persists across runs)
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-text-muted">
          Local variables exist only during workflow execution. Global variables
          are saved to the project.
        </p>
      </div>

      {/* Timing Properties */}
      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
