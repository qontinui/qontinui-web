"use client"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ActionPropertiesComponentProps } from "../types"
import { TimingProperties } from "../TimingProperties"

/**
 * Properties component for GO_TO_STATE action.
 */
export function GoToStateActionProperties({
  action,
  updateConfig,
  states
}: ActionPropertiesComponentProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Target State</Label>
        <Select value={action.config.state || ""} onValueChange={(value) => updateConfig("state", value)}>
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
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  )
}
