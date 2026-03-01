"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";
import { SimilarityThresholdOverride } from "../SimilarityThresholdOverride";
import { SearchStrategyOverride } from "../SearchStrategyOverride";
import type { FindStateActionConfig } from "@/lib/action-schema/configs/find-actions";

/**
 * Properties component for FIND_STATE action.
 *
 * Allows selecting one or more states to check for visibility.
 * Performs a FIND ALL operation on all images of the selected states
 * and returns which states have at least one image currently on screen.
 */
export function FindStateActionProperties({
  action,
  updateConfig,
  states,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as FindStateActionConfig;
  const selectedStates = config.stateIds || [];
  const outputVariable = config.outputVariable || "";

  const handleStateToggle = (stateId: string, checked: boolean) => {
    const newStates = checked
      ? [...selectedStates, stateId]
      : selectedStates.filter((id) => id !== stateId);

    updateConfig("stateIds", newStates);
  };

  const handleOutputVariableChange = (value: string) => {
    updateConfig("outputVariable", value);
  };

  // Count total images across selected states
  const totalImages = selectedStates.reduce((count, stateId) => {
    const state = states.find((s) => s.id === stateId);
    return count + (state?.stateImages?.length || 0);
  }, 0);

  return (
    <>
      <div className="space-y-2">
        <p className="text-xs text-text-muted">
          States to Check{" "}
          {selectedStates.length > 0 && `(${selectedStates.length} selected)`}
        </p>
        <div className="text-xs text-text-muted mb-2">
          Select states to check for visibility. The action will search for all
          images of the selected states and return which states are currently
          active on screen.
        </div>
        <div className="space-y-2 max-h-60 overflow-y-auto border border-border-default rounded p-2">
          {states.length === 0 ? (
            <div className="text-xs text-text-muted p-2">
              No states available
            </div>
          ) : (
            states.map((state) => {
              const imageCount = state.stateImages?.length || 0;
              const isSelected = selectedStates.includes(state.id);

              return (
                <div
                  key={state.id}
                  className="flex items-center space-x-2 p-1 hover:bg-surface-raised rounded"
                >
                  <Checkbox
                    id={`state-${state.id}`}
                    checked={isSelected}
                    onCheckedChange={(checked) =>
                      handleStateToggle(state.id, checked as boolean)
                    }
                    className="border-border-subtle"
                  />
                  <label
                    htmlFor={`state-${state.id}`}
                    className="text-sm text-text-default cursor-pointer flex-1 flex items-center justify-between"
                  >
                    <span>{state.name || state.id}</span>
                    <span className="text-xs text-text-muted">
                      {imageCount} image{imageCount !== 1 ? "s" : ""}
                    </span>
                  </label>
                </div>
              );
            })
          )}
        </div>

        {/* Summary of selected states */}
        {selectedStates.length > 0 && (
          <div className="mt-2 text-xs text-blue-400">
            Will search for {totalImages} image{totalImages !== 1 ? "s" : ""}{" "}
            across {selectedStates.length} state
            {selectedStates.length !== 1 ? "s" : ""}.
          </div>
        )}
      </div>

      {/* Output Variable */}
      <div className="space-y-2 mt-4">
        <Label htmlFor="fsa-output-var" className="text-xs text-text-muted">
          Output Variable (optional)
        </Label>
        <div className="text-xs text-text-muted mb-1">
          Variable name to store the array of active state IDs
        </div>
        <Input
          id="fsa-output-var"
          value={outputVariable}
          onChange={(e) => handleOutputVariableChange(e.target.value)}
          placeholder="e.g., activeStates"
          className="bg-surface-raised border-border-default text-sm"
        />
      </div>

      <SimilarityThresholdOverride
        action={action}
        updateConfig={updateConfig}
      />
      <SearchStrategyOverride action={action} updateConfig={updateConfig} />
      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
