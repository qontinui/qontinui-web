"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";
import type { GoToStateActionConfig } from "@/lib/action-schema/configs/state-actions";
import {
  pathfindingService,
  type PathValidationResult,
} from "@/services/pathfinding-service";
import { useAutomation } from "@/contexts/automation-context";
import type { OutgoingTransition } from "@/contexts/automation-context/types";

/**
 * Properties component for GO_TO_STATE action.
 * Supports selecting multiple target states for pathfinding.
 * Validates reachability when multiple states are selected.
 */
export function GoToStateActionProperties({
  action,
  updateConfig,
  states,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as GoToStateActionConfig;
  const selectedStates = (config.stateIds as string[]) || [];

  // Get transitions from automation context for pathfinding validation
  const { transitions } = useAutomation();

  // Validation state
  const [validationResult, setValidationResult] =
    useState<PathValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced validation
  const validatePath = useCallback(async () => {
    if (selectedStates.length <= 1) {
      setValidationResult(null);
      return;
    }

    setIsValidating(true);
    try {
      // Filter to only outgoing transitions for pathfinding
      const outgoingTransitions = (transitions || []).filter(
        (t): t is OutgoingTransition => t.type === "OutgoingTransition"
      );

      const result = await pathfindingService.validatePath(
        states,
        outgoingTransitions,
        selectedStates
      );
      setValidationResult(result);
    } catch (error) {
      console.error("Validation error:", error);
      setValidationResult({
        reachable: false,
        path: null,
        reason: "Validation service unavailable",
        details: null,
      });
    } finally {
      setIsValidating(false);
    }
  }, [selectedStates, states, transitions]);

  // Trigger validation when selected states change (debounced)
  useEffect(() => {
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
    }

    if (selectedStates.length > 1) {
      validationTimeoutRef.current = setTimeout(() => {
        validatePath();
      }, 500); // 500ms debounce
    } else {
      setValidationResult(null);
    }

    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
    };
  }, [selectedStates, validatePath]);

  const handleStateToggle = (stateId: string, checked: boolean) => {
    const newStates = checked
      ? [...selectedStates, stateId]
      : selectedStates.filter((id) => id !== stateId);

    updateConfig("stateIds", newStates);
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

        {/* Validation feedback */}
        {selectedStates.length > 1 && (
          <div className="mt-2 space-y-1">
            {isValidating ? (
              <div className="text-xs text-gray-400 flex items-center gap-1">
                <span className="animate-spin">&#8635;</span>
                Validating path reachability...
              </div>
            ) : validationResult ? (
              validationResult.reachable ? (
                <div className="text-xs text-green-400 flex items-center gap-1">
                  <span>&#10003;</span>
                  {validationResult.reason ||
                    "All selected states can be reached simultaneously"}
                  {validationResult.path && (
                    <span className="text-gray-500">
                      ({validationResult.path.length} transition
                      {validationResult.path.length !== 1 ? "s" : ""})
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-amber-400">
                  <div className="flex items-center gap-1">
                    <span>&#9888;</span>
                    <span className="font-medium">Warning:</span>{" "}
                    {validationResult.reason ||
                      "Selected states may not be reachable simultaneously"}
                  </div>
                  {(() => {
                    const unreachable =
                      validationResult.details?.unreachable_targets;
                    if (Array.isArray(unreachable) && unreachable.length > 0) {
                      return (
                        <div className="mt-1 text-gray-500 pl-4">
                          Unreachable: {unreachable.join(", ")}
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              )
            ) : (
              <div className="text-xs text-blue-400">
                Multiple states selected: The runner will use pathfinding to
                reach all selected states.
              </div>
            )}
          </div>
        )}
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
