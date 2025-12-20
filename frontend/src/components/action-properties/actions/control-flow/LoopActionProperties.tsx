"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RotateCw } from "lucide-react";
import { ActionPropertiesComponentProps } from "../../types";
import { TimingProperties } from "../../TimingProperties";
import {
  ConditionEditor,
  ActionListEditor,
  VariableSelector,
} from "../../shared";
import { LoopActionConfig } from "@/lib/action-schema";

/**
 * Properties component for LOOP action.
 *
 * Allows users to:
 * - Select loop type (FOR, WHILE, FOREACH)
 * - Configure loop parameters based on type
 * - Define actions to execute in each iteration
 * - Set safety limits (max iterations)
 */
export function LoopActionProperties({
  action,
  updateConfig,
  images,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as LoopActionConfig;

  // Initialize config with defaults if needed
  const loopType = config.loopType || "FOR";
  const actions = config.actions || [];
  const maxIterations =
    config.maxIterations !== undefined ? config.maxIterations : 1000;
  const breakOnError =
    config.breakOnError !== undefined ? config.breakOnError : true;

  const handleLoopTypeChange = (newType: LoopActionConfig["loopType"]) => {
    // Reset type-specific fields when changing loop type
    const updates: Partial<LoopActionConfig> = {
      loopType: newType,
      iterations: undefined,
      condition: undefined,
      collection: undefined,
      iteratorVariable: undefined,
    };

    // Set defaults for new type
    if (newType === "FOR") {
      updates.iterations = 10;
      updates.iteratorVariable = "i";
    } else if (newType === "WHILE") {
      updates.condition = {
        type: "variable",
        variableName: "",
        operator: "==",
        expectedValue: "",
      };
    } else if (newType === "FOREACH") {
      updates.collection = {
        type: "variable",
        variableName: "",
      };
      updates.iteratorVariable = "item";
    }

    // Apply all updates at once
    updateConfig("__reset__", { ...config, ...updates });
  };

  return (
    <>
      {/* Loop Type Indicator */}
      <div className="flex items-center gap-2 p-3 bg-purple-500/10 border border-purple-500/30 rounded-md">
        <RotateCw className="w-4 h-4 text-purple-400" />
        <div className="flex-1">
          <p className="text-sm font-medium text-purple-300">Loop Action</p>
          <p className="text-xs text-purple-400/70">
            Repeat actions multiple times
          </p>
        </div>
      </div>

      {/* Loop Type Selector */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Loop Type</Label>
        <Select value={loopType} onValueChange={handleLoopTypeChange}>
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="FOR">
              FOR - Fixed number of iterations
            </SelectItem>
            <SelectItem value="WHILE">
              WHILE - Repeat while condition is true
            </SelectItem>
            <SelectItem value="FOREACH">
              FOREACH - Iterate over collection
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-500">
          {loopType === "FOR" && "Execute actions a fixed number of times"}
          {loopType === "WHILE" &&
            "Execute actions while a condition remains true"}
          {loopType === "FOREACH" &&
            "Execute actions for each item in a collection"}
        </p>
      </div>

      {/* FOR Loop Configuration */}
      {loopType === "FOR" && (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">
              Number of Iterations
            </Label>
            <Input
              type="number"
              min="1"
              value={config.iterations || 10}
              onChange={(e) =>
                updateConfig("iterations", Number.parseInt(e.target.value) || 1)
              }
              className="bg-transparent border-gray-700"
            />
            <p className="text-xs text-gray-500">
              How many times to repeat the loop
            </p>
          </div>

          <VariableSelector
            label="Iterator Variable Name"
            value={config.iteratorVariable || "i"}
            onChange={(name) =>
              updateConfig("iteratorVariable", name || undefined)
            }
            placeholder="i"
            required={false}
          />
          <p className="text-xs text-gray-500 -mt-2">
            Variable to store the current iteration number (0-based)
          </p>
        </>
      )}

      {/* WHILE Loop Configuration */}
      {loopType === "WHILE" && (
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">Loop Condition</Label>
          <div className="p-3 bg-gray-800/50 rounded-md border border-gray-700">
            <ConditionEditor
              condition={config.condition}
              onChange={(condition) => updateConfig("condition", condition)}
              label=""
              allowEmpty={false}
              images={images.map((img) => ({ id: img.id, name: img.name }))}
            />
          </div>
          <p className="text-xs text-gray-500">
            Loop continues while this condition evaluates to true
          </p>
        </div>
      )}

      {/* FOREACH Loop Configuration */}
      {loopType === "FOREACH" && (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Collection Type</Label>
            <Select
              value={config.collection?.type || "variable"}
              onValueChange={(type) =>
                updateConfig("collection", {
                  type,
                  ...(type === "variable" && { variableName: "" }),
                  ...(type === "range" && { start: 0, end: 10, step: 1 }),
                })
              }
            >
              <SelectTrigger className="bg-transparent border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="variable">Variable (array)</SelectItem>
                <SelectItem value="range">Numeric Range</SelectItem>
                <SelectItem value="matches">Image Matches</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Variable Collection */}
          {config.collection?.type === "variable" && (
            <VariableSelector
              label="Variable Name"
              value={config.collection.variableName || ""}
              onChange={(name) =>
                updateConfig("collection", {
                  ...config.collection,
                  variableName: name,
                })
              }
              placeholder="myArray"
              required
            />
          )}

          {/* Range Collection */}
          {config.collection?.type === "range" && (
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-2">
                <Label className="text-xs text-gray-500">Start</Label>
                <Input
                  type="number"
                  value={config.collection.start ?? 0}
                  onChange={(e) =>
                    updateConfig("collection", {
                      ...config.collection,
                      start: Number.parseInt(e.target.value) || 0,
                    })
                  }
                  className="bg-transparent border-gray-700"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-gray-500">End</Label>
                <Input
                  type="number"
                  value={config.collection.end ?? 10}
                  onChange={(e) =>
                    updateConfig("collection", {
                      ...config.collection,
                      end: Number.parseInt(e.target.value) || 10,
                    })
                  }
                  className="bg-transparent border-gray-700"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-gray-500">Step</Label>
                <Input
                  type="number"
                  value={config.collection.step ?? 1}
                  onChange={(e) =>
                    updateConfig("collection", {
                      ...config.collection,
                      step: Number.parseInt(e.target.value) || 1,
                    })
                  }
                  className="bg-transparent border-gray-700"
                />
              </div>
            </div>
          )}

          {/* Matches Collection */}
          {config.collection?.type === "matches" && (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs text-yellow-300">
              <p className="font-medium">Coming Soon</p>
              <p className="text-yellow-400 mt-1">
                Image matching collection will be implemented in a future update
              </p>
            </div>
          )}

          <VariableSelector
            label="Iterator Variable Name"
            value={config.iteratorVariable || "item"}
            onChange={(name) =>
              updateConfig("iteratorVariable", name || undefined)
            }
            placeholder="item"
            required={false}
          />
          <p className="text-xs text-gray-500 -mt-2">
            Variable to store the current item in each iteration
          </p>
        </>
      )}

      {/* Loop Body Actions */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-purple-500 rounded" />
          <Label className="text-xs text-purple-400">Loop Body Actions</Label>
        </div>
        <div className="pl-3 border-l-2 border-purple-500/30">
          <ActionListEditor
            actionIds={actions}
            onChange={(newActions) => updateConfig("actions", newActions)}
            emptyText="Add actions to execute in each iteration"
            minActions={0}
          />
        </div>
        <p className="text-xs text-gray-500">
          Actions to execute in each iteration of the loop
        </p>
      </div>

      {/* Safety Settings */}
      <div className="space-y-3 p-3 bg-gray-800/30 border border-gray-700 rounded-md">
        <Label className="text-xs text-gray-400 font-medium">
          Safety Settings
        </Label>

        <div className="space-y-2">
          <Label className="text-xs text-gray-500">Max Iterations</Label>
          <Input
            type="number"
            min="1"
            value={maxIterations}
            onChange={(e) =>
              updateConfig(
                "maxIterations",
                Number.parseInt(e.target.value) || 1000
              )
            }
            className="bg-transparent border-gray-700"
          />
          <p className="text-xs text-gray-500">
            Safety limit to prevent infinite loops (default: 1000)
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="breakOnError"
            checked={breakOnError}
            onCheckedChange={(checked) => updateConfig("breakOnError", checked)}
          />
          <label
            htmlFor="breakOnError"
            className="text-xs text-gray-400 cursor-pointer select-none"
          >
            Break loop on error
          </label>
        </div>
        <p className="text-xs text-gray-500">
          If enabled, the loop will stop if any action throws an error
        </p>
      </div>

      {/* Usage Tips */}
      <div className="p-3 bg-gray-800/30 border border-gray-700 rounded-md">
        <p className="text-xs text-gray-400 font-medium mb-2">Tips:</p>
        <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
          <li>Use BREAK action inside loop to exit early</li>
          <li>Use CONTINUE action to skip to next iteration</li>
          <li>Iterator variable is accessible within loop body actions</li>
          <li>Set reasonable max iterations to prevent runaway loops</li>
        </ul>
      </div>

      {/* Timing Properties */}
      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
