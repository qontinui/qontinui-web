"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";
import type { RunWorkflowActionConfig } from "@/lib/action-schema/configs/state-actions";

/**
 * Properties component for RUN_WORKFLOW action.
 */
export function RunWorkflowActionProperties({
  action,
  updateConfig,
  processes,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as RunWorkflowActionConfig;

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Workflow to Run</Label>
        <Select
          value={(config.workflowId as string) || ""}
          onValueChange={(value) => updateConfig("workflowId", value)}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue placeholder="Select a workflow" />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            {processes.map((process) => (
              <SelectItem key={process.id} value={process.id}>
                {process.name || process.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Repeat Configuration */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-gray-400">Repeat Workflow</Label>
          <Checkbox
            id="enableRepeat"
            checked={((config as unknown as Record<string, unknown>).enableRepeat as boolean) || false}
            onCheckedChange={(checked) => {
              if (checked) {
                updateConfig("enableRepeat", true);
                // Set default values when enabling repeat
                if ((config as unknown as Record<string, unknown>).maxRepeats === undefined) {
                  updateConfig("maxRepeats", 10);
                }
              } else {
                // Clear repeat configuration when disabling
                const {
                  enableRepeat: _enableRepeat,
                  maxRepeats: _maxRepeats,
                  repeatDelay: _repeatDelay,
                  repeatUntilSuccess: _repeatUntilSuccess,
                  ...rest
                } = config as unknown as Record<string, unknown>;
                updateConfig("__reset__", rest);
              }
            }}
          />
        </div>

        {Boolean((config as unknown as Record<string, unknown>).enableRepeat) && (
          <>
            <div className="space-y-2 pl-4 border-l-2 border-[#BD00FF]/30">
              {/* Max Repeats */}
              <div className="space-y-1">
                <Label className="text-xs text-gray-400">Max Repeats</Label>
                <Input
                  type="number"
                  min="1"
                  max="1000"
                  value={((config as unknown as Record<string, unknown>).maxRepeats as number) || 10}
                  onChange={(e) =>
                    updateConfig(
                      "maxRepeats",
                      Number.parseInt(e.target.value) || 10
                    )
                  }
                  className="bg-transparent border-gray-700"
                  placeholder="10"
                />
                <p className="text-xs text-gray-500">
                  {(config as unknown as Record<string, unknown>).repeatUntilSuccess
                    ? "Maximum attempts before giving up"
                    : "How many times to repeat (1 = run once more)"}
                </p>
              </div>

              {/* Delay Between Repeats */}
              <div className="space-y-1">
                <Label className="text-xs text-gray-400">
                  Delay Between Repeats (ms)
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={((config as unknown as Record<string, unknown>).repeatDelay as number) || 0}
                  onChange={(e) =>
                    updateConfig(
                      "repeatDelay",
                      Number.parseInt(e.target.value) || 0
                    )
                  }
                  className="bg-transparent border-gray-700"
                  placeholder="0"
                />
                <p className="text-xs text-gray-500">
                  Pause between each repeat execution
                </p>
              </div>

              {/* Repeat Until Success or Max Repeats */}
              <div className="flex items-start space-x-2">
                <Checkbox
                  id="repeatUntilSuccess"
                  checked={
                    ((config as unknown as Record<string, unknown>).repeatUntilSuccess as boolean) || false
                  }
                  onCheckedChange={(checked) =>
                    updateConfig("repeatUntilSuccess", checked)
                  }
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="repeatUntilSuccess"
                    className="text-xs text-gray-400 cursor-pointer"
                  >
                    Repeat Until Success or Max Repeats
                  </Label>
                  <p className="text-xs text-gray-500">
                    Stop early if workflow succeeds, otherwise continue until
                    Max Repeats
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
