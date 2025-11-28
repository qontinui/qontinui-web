"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";
import { SimilarityThresholdOverride } from "../SimilarityThresholdOverride";
import { SearchStrategyOverride } from "../SearchStrategyOverride";

/**
 * Properties component for FIND_STATE_IMAGE action.
 */
export function FindStateImageProperties({
  action,
  updateConfig,
  states,
}: ActionPropertiesComponentProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Select State</Label>
        <Select
          value={action.config.state || ""}
          onValueChange={(value) => updateConfig("state", value)}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue placeholder="Select a state" />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            {states.map((state) => (
              <SelectItem key={state.id} value={state.id}>
                {state.name || state.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {action.config.state && (
          <div className="text-xs text-gray-400 mt-2">
            {(() => {
              const selectedState = states.find(
                (s) => s.id === action.config.state
              );
              if (selectedState && selectedState.stateImages?.length > 0) {
                return `Will find any of ${selectedState.stateImages.length} image${selectedState.stateImages.length > 1 ? "s" : ""} from ${selectedState.name}`;
              }
              return selectedState
                ? `No images defined for ${selectedState.name}`
                : "State not found";
            })()}
          </div>
        )}
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
