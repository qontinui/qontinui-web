"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  SuccessCriteria,
  SuccessCriteriaType,
  isMinMatchesCriteria,
  isMaxFailuresCriteria,
  isCheckpointPassedCriteria,
  isRequiredStatesCriteria,
  isCustomCriteria,
} from "@/lib/expectations/types";

interface SuccessCriteriaEditorProps {
  criteria: SuccessCriteria | undefined;
  onChange: (criteria: SuccessCriteria) => void;
  availableCheckpoints?: string[];
  availableStates?: string[];
}

const DEFAULT_CHECKPOINTS: string[] = [];
const DEFAULT_STATES: string[] = [];

/**
 * Workflow Success Criteria Editor Component
 *
 * Allows users to define success criteria for workflow validation:
 * - all_actions_pass: All workflow actions must complete successfully (default)
 * - min_matches: Minimum number of pattern matches required
 * - max_failures: Maximum number of allowed failures
 * - checkpoint_passed: Specific checkpoint must be reached
 * - required_states: Specific states must be discovered
 * - custom: Custom Python expression for validation
 */
export function SuccessCriteriaEditor({
  criteria,
  onChange,
  availableCheckpoints = DEFAULT_CHECKPOINTS,
  availableStates = DEFAULT_STATES,
}: SuccessCriteriaEditorProps) {
  const [stateInput, setStateInput] = useState("");

  // Initialize with defaults
  const currentCriteria: SuccessCriteria = criteria || {
    type: "all_actions_pass",
  };

  const handleTypeChange = (newType: SuccessCriteriaType) => {
    // Set type-specific defaults based on the schema types
    let updatedCriteria: SuccessCriteria;

    switch (newType) {
      case "min_matches":
        updatedCriteria = {
          type: "min_matches",
          min_matches: isMinMatchesCriteria(currentCriteria)
            ? currentCriteria.min_matches
            : 1,
          description: currentCriteria.description,
        };
        break;
      case "max_failures":
        updatedCriteria = {
          type: "max_failures",
          max_failures: isMaxFailuresCriteria(currentCriteria)
            ? currentCriteria.max_failures
            : 0,
          description: currentCriteria.description,
        };
        break;
      case "checkpoint_passed":
        updatedCriteria = {
          type: "checkpoint_passed",
          checkpoint_name: isCheckpointPassedCriteria(currentCriteria)
            ? currentCriteria.checkpoint_name
            : "",
          description: currentCriteria.description,
        };
        break;
      case "required_states":
        updatedCriteria = {
          type: "required_states",
          required_states: isRequiredStatesCriteria(currentCriteria)
            ? currentCriteria.required_states
            : [],
          description: currentCriteria.description,
        };
        break;
      case "custom":
        updatedCriteria = {
          type: "custom",
          custom_expression: isCustomCriteria(currentCriteria)
            ? currentCriteria.custom_expression
            : "",
          description: currentCriteria.description,
        };
        break;
      default:
        updatedCriteria = {
          type: "all_actions_pass",
          description: currentCriteria.description,
        };
        break;
    }

    onChange(updatedCriteria);
  };

  const handleDescriptionChange = (description: string) => {
    onChange({
      ...currentCriteria,
      description,
    });
  };

  const handleMinMatchesChange = (value: string) => {
    const min_matches = parseInt(value, 10);
    if (
      !isNaN(min_matches) &&
      min_matches >= 0 &&
      isMinMatchesCriteria(currentCriteria)
    ) {
      onChange({
        ...currentCriteria,
        min_matches,
      });
    }
  };

  const handleMaxFailuresChange = (value: string) => {
    const max_failures = parseInt(value, 10);
    if (
      !isNaN(max_failures) &&
      max_failures >= 0 &&
      isMaxFailuresCriteria(currentCriteria)
    ) {
      onChange({
        ...currentCriteria,
        max_failures,
      });
    }
  };

  const handleCheckpointChange = (checkpoint_name: string) => {
    if (isCheckpointPassedCriteria(currentCriteria)) {
      onChange({
        ...currentCriteria,
        checkpoint_name,
      });
    }
  };

  const handleCustomExpressionChange = (custom_expression: string) => {
    if (isCustomCriteria(currentCriteria)) {
      onChange({
        ...currentCriteria,
        custom_expression,
      });
    }
  };

  const handleAddState = () => {
    if (
      stateInput.trim() &&
      isRequiredStatesCriteria(currentCriteria) &&
      !currentCriteria.required_states.includes(stateInput.trim())
    ) {
      onChange({
        ...currentCriteria,
        required_states: [
          ...currentCriteria.required_states,
          stateInput.trim(),
        ],
      });
      setStateInput("");
    }
  };

  const handleRemoveState = (stateToRemove: string) => {
    if (isRequiredStatesCriteria(currentCriteria)) {
      onChange({
        ...currentCriteria,
        required_states: currentCriteria.required_states.filter(
          (state) => state !== stateToRemove
        ),
      });
    }
  };

  const handleStateKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddState();
    }
  };

  const getTypeDescription = (type: SuccessCriteriaType): string => {
    switch (type) {
      case "all_actions_pass":
        return "All workflow actions must complete successfully without errors";
      case "min_matches":
        return "Require a minimum number of pattern matches to be found";
      case "max_failures":
        return "Allow up to a maximum number of action failures";
      case "checkpoint_passed":
        return "Workflow must reach a specific checkpoint to be considered successful";
      case "required_states":
        return "Specific application states must be discovered during execution";
      case "custom":
        return "Define a custom Python expression for success validation";
      default:
        return "";
    }
  };

  return (
    <div className="space-y-4">
      {/* Success Criteria Header */}
      <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-md">
        <CheckCircle2 className="w-4 h-4 text-green-400" />
        <div className="flex-1">
          <p className="text-sm font-medium text-green-300">Success Criteria</p>
          <p className="text-xs text-green-400/70">
            Define conditions that determine workflow success
          </p>
        </div>
      </div>

      {/* Criteria Type Selection */}
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Criteria Type</Label>
        <Select value={currentCriteria.type} onValueChange={handleTypeChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select criteria type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all_actions_pass">All Actions Pass</SelectItem>
            <SelectItem value="min_matches">Minimum Matches</SelectItem>
            <SelectItem value="max_failures">Maximum Failures</SelectItem>
            <SelectItem value="checkpoint_passed">Checkpoint Passed</SelectItem>
            <SelectItem value="required_states">Required States</SelectItem>
            <SelectItem value="custom">Custom Expression</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-text-muted">
          {getTypeDescription(currentCriteria.type)}
        </p>
      </div>

      {/* Type-Specific Inputs */}
      {isMinMatchesCriteria(currentCriteria) && (
        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Minimum Matches</Label>
          <Input
            type="number"
            min="1"
            value={currentCriteria.min_matches}
            onChange={(e) => handleMinMatchesChange(e.target.value)}
            placeholder="Enter minimum number of matches"
            className="w-full"
          />
          <p className="text-xs text-text-muted">
            Workflow succeeds if at least this many pattern matches are found
          </p>
        </div>
      )}

      {isMaxFailuresCriteria(currentCriteria) && (
        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Maximum Failures</Label>
          <Input
            type="number"
            min="0"
            value={currentCriteria.max_failures}
            onChange={(e) => handleMaxFailuresChange(e.target.value)}
            placeholder="Enter maximum allowed failures"
            className="w-full"
          />
          <p className="text-xs text-text-muted">
            Workflow succeeds if failures do not exceed this number
          </p>
        </div>
      )}

      {isCheckpointPassedCriteria(currentCriteria) && (
        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Checkpoint Name</Label>
          {availableCheckpoints.length > 0 ? (
            <Select
              value={currentCriteria.checkpoint_name || ""}
              onValueChange={handleCheckpointChange}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select checkpoint" />
              </SelectTrigger>
              <SelectContent>
                {availableCheckpoints.map((checkpoint) => (
                  <SelectItem key={checkpoint} value={checkpoint}>
                    {checkpoint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              type="text"
              value={currentCriteria.checkpoint_name || ""}
              onChange={(e) => handleCheckpointChange(e.target.value)}
              placeholder="Enter checkpoint name"
              className="w-full"
            />
          )}
          <p className="text-xs text-text-muted">
            Workflow must reach this checkpoint to be considered successful
          </p>
        </div>
      )}

      {isRequiredStatesCriteria(currentCriteria) && (
        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Required States</Label>

          {/* State Tags Display */}
          {currentCriteria.required_states.length > 0 && (
            <div className="flex flex-wrap gap-2 p-3 bg-surface-raised/50 rounded-md border border-border-default">
              {currentCriteria.required_states.map((state) => (
                <Badge
                  key={state}
                  variant="secondary"
                  className="flex items-center gap-1 pr-1"
                >
                  <span>{state}</span>
                  <button
                    onClick={() => handleRemoveState(state)}
                    className="ml-1 hover:bg-surface-raised rounded p-0.5"
                    aria-label={`Remove state ${state}`}
                    title="Remove state"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {/* State Input */}
          <div className="flex gap-2">
            {availableStates.length > 0 ? (
              <Select
                value=""
                onValueChange={(value) => {
                  if (
                    value &&
                    isRequiredStatesCriteria(currentCriteria) &&
                    !currentCriteria.required_states.includes(value)
                  ) {
                    onChange({
                      ...currentCriteria,
                      required_states: [
                        ...currentCriteria.required_states,
                        value,
                      ],
                    });
                  }
                }}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select state to add" />
                </SelectTrigger>
                <SelectContent>
                  {availableStates
                    .filter(
                      (state) =>
                        !currentCriteria.required_states.includes(state)
                    )
                    .map((state) => (
                      <SelectItem key={state} value={state}>
                        {state}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            ) : (
              <>
                <Input
                  type="text"
                  value={stateInput}
                  onChange={(e) => setStateInput(e.target.value)}
                  onKeyDown={handleStateKeyDown}
                  placeholder="Enter state name"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddState}
                  disabled={!stateInput.trim()}
                >
                  Add
                </Button>
              </>
            )}
          </div>
          <p className="text-xs text-text-muted">
            All listed states must be discovered during workflow execution
          </p>
        </div>
      )}

      {isCustomCriteria(currentCriteria) && (
        <div className="space-y-2">
          <Label className="text-xs text-text-muted">
            Custom Python Expression
          </Label>
          <Textarea
            value={currentCriteria.custom_expression}
            onChange={(e) => handleCustomExpressionChange(e.target.value)}
            placeholder="Enter Python expression (e.g., len(matches) > 5 and failures == 0)"
            className="font-mono text-sm min-h-24"
          />
          <p className="text-xs text-text-muted">
            Python expression evaluated in workflow context. Available
            variables: matches, failures, states, checkpoints
          </p>
        </div>
      )}

      {/* Description Field (for all types) */}
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">
          Description (Optional)
        </Label>
        <Textarea
          value={currentCriteria.description || ""}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          placeholder="Add a description for this success criteria"
          className="min-h-16"
        />
        <p className="text-xs text-text-muted">
          Helpful context about why this criteria was chosen
        </p>
      </div>

      {/* Usage Tips */}
      <div className="p-3 bg-surface-raised/30 border border-border-default rounded-md">
        <p className="text-xs text-text-muted font-medium mb-2">Tips:</p>
        <ul className="text-xs text-text-muted space-y-1 list-disc list-inside">
          <li>Success criteria validate workflow execution results</li>
          <li>Use min_matches for state discovery workflows</li>
          <li>Use checkpoints to validate multi-step workflows</li>
          <li>Custom expressions provide maximum flexibility</li>
        </ul>
      </div>
    </div>
  );
}
