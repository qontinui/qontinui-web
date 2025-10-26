"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ActionPropertiesComponentProps } from "../types"
import { TimingProperties } from "../TimingProperties"

/**
 * Properties component for CLICK action.
 */
export function ClickActionProperties({
  action,
  updateConfig
}: ActionPropertiesComponentProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Target</Label>
        <Select value={action.config.target || "Last Find Result"} onValueChange={(value) => updateConfig("target", value)}>
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            <SelectItem value="Last Find Result">Last Find Result</SelectItem>
            <SelectItem value="Current Position">Current Position</SelectItem>
            <SelectItem value="Coordinates">Coordinates</SelectItem>
            <SelectItem value="StateImage">State Image</SelectItem>
            <SelectItem value="StateRegion">State Region</SelectItem>
            <SelectItem value="StateLocation">State Location</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {action.config.target === "Coordinates" && (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">X Coordinate</Label>
            <Input
              type="number"
              value={action.config.x || 0}
              onChange={(e) => updateConfig("x", Number.parseInt(e.target.value))}
              className="bg-transparent border-gray-700"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Y Coordinate</Label>
            <Input
              type="number"
              value={action.config.y || 0}
              onChange={(e) => updateConfig("y", Number.parseInt(e.target.value))}
              className="bg-transparent border-gray-700"
            />
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Click Type</Label>
        <Select value={action.config.clickType} onValueChange={(value) => updateConfig("clickType", value)}>
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            <SelectItem value="left">Left Click</SelectItem>
            <SelectItem value="right">Right Click</SelectItem>
            <SelectItem value="middle">Middle Click</SelectItem>
            <SelectItem value="double">Double Click</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Click Count</Label>
        <Input
          type="number"
          min="1"
          value={action.config.clickCount}
          onChange={(e) => updateConfig("clickCount", Number.parseInt(e.target.value))}
          className="bg-transparent border-gray-700"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Hold Duration (ms)</Label>
        <Input
          type="number"
          min="0"
          value={action.config.hold_duration}
          onChange={(e) => updateConfig("hold_duration", Number.parseInt(e.target.value))}
          className="bg-transparent border-gray-700"
        />
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  )
}
