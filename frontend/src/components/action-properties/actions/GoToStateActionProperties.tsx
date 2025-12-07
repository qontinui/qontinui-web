"use client";

import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";

/**
 * Properties component for GO_TO_STATE action.
 * Supports selecting multiple target states for pathfinding.
 */
export function GoToStateActionProperties({
  action,
  updateConfig,
  states,
}: ActionPropertiesComponentProps) {
  const selectedStates = (action.config.states as string[]) || [];

  const handleStateToggle = (stateId: string, checked: boolean) => {
    const newStates = checked
      ? [...selectedStates, stateId]
      : selectedStates.filter((id) => id !== stateId);

    updateConfig("states", newStates);
  };

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">
          Target States{" "}
          {selectedStates.length > 0 && `(${selectedStates.length} selected)`}
        </Label>
        <div className="text-xs text-gray-500 mb-2">
          Select one or more states to navigate to. The runner will find the
          optimal path.
        </div>
        <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-700 rounded p-2">
          {states.length === 0 ? (
            <div className="text-xs text-gray-500 p-2">No states available</div>
          ) : (
            states.map((state) => (
              <div
                key={state.id}
                className="flex items-center space-x-2 p-1 hover:bg-gray-800 rounded"
              >
                <Checkbox
                  id={`state-${state.id}`}
                  checked={selectedStates.includes(state.id)}
                  onCheckedChange={(checked) =>
                    handleStateToggle(state.id, checked as boolean)
                  }
                  className="border-gray-600"
                />
                <label
                  htmlFor={`state-${state.id}`}
                  className="text-sm text-gray-300 cursor-pointer flex-1"
                >
                  {state.name || state.id}
                </label>
              </div>
            ))
          )}
        </div>
        {selectedStates.length > 1 && (
          <div className="text-xs text-blue-400 mt-2">
            💡 Multiple states selected: The runner will use pathfinding to
            reach all selected states.
          </div>
        )}
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
