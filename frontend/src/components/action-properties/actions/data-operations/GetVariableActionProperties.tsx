"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ActionPropertiesComponentProps } from "../../types";
import { TimingProperties } from "../../TimingProperties";
import { VariableSelector } from "../../shared";
import { GetVariableActionConfig } from "@/lib/action-schema";

/**
 * Properties component for GET_VARIABLE action.
 *
 * Allows users to:
 * - Specify the variable name to retrieve
 * - Optionally set an output variable (where to store the value)
 * - Optionally set a default value if the variable doesn't exist
 */
export function GetVariableActionProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const config = action.config as GetVariableActionConfig;

  return (
    <>
      {/* Variable Name to Get */}
      <VariableSelector
        label="Variable Name"
        value={config.variableName || ""}
        onChange={(name) => updateConfig("variableName", name)}
        placeholder="variableToGet"
        required
      />

      {/* Output Variable (Optional) */}
      <VariableSelector
        label="Output Variable (Optional)"
        value={config.outputVariable || ""}
        onChange={(name) => updateConfig("outputVariable", name || undefined)}
        placeholder="outputVariable"
      />
      <p className="text-xs text-gray-500 -mt-1">
        If specified, the value will be stored in this variable. Leave empty to
        use the same variable name.
      </p>

      {/* Default Value (Optional) */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">
          Default Value (Optional)
        </Label>
        <Input
          type="text"
          value={config.defaultValue?.toString() || ""}
          onChange={(e) => {
            const value = e.target.value;
            updateConfig("defaultValue", value || undefined);
          }}
          placeholder="default value"
          className="bg-transparent border-gray-700 font-mono text-sm"
        />
        <p className="text-xs text-gray-500">
          Value to use if the variable doesn't exist. Numbers and booleans will
          be automatically converted.
        </p>
      </div>

      {/* Timing Properties */}
      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
