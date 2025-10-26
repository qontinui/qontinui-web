"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ActionPropertiesComponentProps } from "../types"
import { TimingProperties } from "../TimingProperties"

/**
 * Properties component for RUN_WORKFLOW action.
 */
export function RunWorkflowActionProperties({
  action,
  updateConfig,
  processes
}: ActionPropertiesComponentProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Workflow to Run</Label>
        <Select value={action.config.workflowId || ""} onValueChange={(value) => updateConfig("workflowId", value)}>
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
            checked={action.config.enableRepeat || false}
            onCheckedChange={(checked) => {
              if (checked) {
                updateConfig("enableRepeat", true)
                // Set default values when enabling repeat
                if (action.config.maxRepeats === undefined) {
                  updateConfig("maxRepeats", 10)
                }
              } else {
                // Clear repeat configuration when disabling
                const { enableRepeat, maxRepeats, repeatDelay, repeatUntilSuccess, ...rest } = action.config
                updateConfig("__reset__", rest)
              }
            }}
          />
        </div>

        {action.config.enableRepeat && (
          <>
            <div className="space-y-2 pl-4 border-l-2 border-[#BD00FF]/30">
              {/* Max Repeats */}
              <div className="space-y-1">
                <Label className="text-xs text-gray-400">Max Repeats</Label>
                <Input
                  type="number"
                  min="1"
                  max="1000"
                  value={action.config.maxRepeats || 10}
                  onChange={(e) => updateConfig("maxRepeats", Number.parseInt(e.target.value) || 10)}
                  className="bg-transparent border-gray-700"
                  placeholder="10"
                />
                <p className="text-xs text-gray-500">
                  {action.config.repeatUntilSuccess
                    ? "Maximum attempts before giving up"
                    : "How many times to repeat (1 = run once more)"
                  }
                </p>
              </div>

              {/* Delay Between Repeats */}
              <div className="space-y-1">
                <Label className="text-xs text-gray-400">Delay Between Repeats (ms)</Label>
                <Input
                  type="number"
                  min="0"
                  value={action.config.repeatDelay || 0}
                  onChange={(e) => updateConfig("repeatDelay", Number.parseInt(e.target.value) || 0)}
                  className="bg-transparent border-gray-700"
                  placeholder="0"
                />
                <p className="text-xs text-gray-500">Pause between each repeat execution</p>
              </div>

              {/* Repeat Until Success or Max Repeats */}
              <div className="flex items-start space-x-2">
                <Checkbox
                  id="repeatUntilSuccess"
                  checked={action.config.repeatUntilSuccess || false}
                  onCheckedChange={(checked) => updateConfig("repeatUntilSuccess", checked)}
                />
                <div className="space-y-1">
                  <Label htmlFor="repeatUntilSuccess" className="text-xs text-gray-400 cursor-pointer">
                    Repeat Until Success or Max Repeats
                  </Label>
                  <p className="text-xs text-gray-500">
                    Stop early if workflow succeeds, otherwise continue until Max Repeats
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  )
}
