"use client";

import { Input } from "@/components/ui/input";
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

/**
 * Properties component for MOUSE_MOVE action.
 */
export function MouseMoveProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Target</Label>
        <Select
          value={action.config.target}
          onValueChange={(value) => updateConfig("target", value)}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            <SelectItem value="Last Find Result">Last Find Result</SelectItem>
            <SelectItem value="Coordinates">Coordinates</SelectItem>
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
              onChange={(e) =>
                updateConfig("x", Number.parseInt(e.target.value))
              }
              className="bg-transparent border-gray-700"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Y Coordinate</Label>
            <Input
              type="number"
              value={action.config.y || 0}
              onChange={(e) =>
                updateConfig("y", Number.parseInt(e.target.value))
              }
              className="bg-transparent border-gray-700"
            />
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Movement Duration (ms)</Label>
        <Input
          type="number"
          min="0"
          value={action.config.duration || 0}
          onChange={(e) =>
            updateConfig("duration", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-gray-700"
        />
        <p className="text-xs text-gray-500">
          0 = instant movement, &gt;0 = smooth animation
        </p>
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}

/**
 * Properties component for MOUSE_DOWN and MOUSE_UP actions.
 */
export function MouseButtonProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Button</Label>
        <Select
          value={action.config.button || "left"}
          onValueChange={(value) => updateConfig("button", value)}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="right">Right</SelectItem>
            <SelectItem value="middle">Middle</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Target (Optional)</Label>
        <Select
          value={action.config.target || "Current Position"}
          onValueChange={(value) => updateConfig("target", value)}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            <SelectItem value="Current Position">Current Position</SelectItem>
            <SelectItem value="Last Find Result">Last Find Result</SelectItem>
            <SelectItem value="Coordinates">Coordinates</SelectItem>
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
              onChange={(e) =>
                updateConfig("x", Number.parseInt(e.target.value))
              }
              className="bg-transparent border-gray-700"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Y Coordinate</Label>
            <Input
              type="number"
              value={action.config.y || 0}
              onChange={(e) =>
                updateConfig("y", Number.parseInt(e.target.value))
              }
              className="bg-transparent border-gray-700"
            />
          </div>
        </>
      )}

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}

/**
 * Properties component for DOUBLE_CLICK and RIGHT_CLICK actions.
 */
export function SimpleClickProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Target</Label>
        <Select
          value={action.config.target}
          onValueChange={(value) => updateConfig("target", value)}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            <SelectItem value="Last Find Result">Last Find Result</SelectItem>
            <SelectItem value="Coordinates">Coordinates</SelectItem>
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
              onChange={(e) =>
                updateConfig("x", Number.parseInt(e.target.value))
              }
              className="bg-transparent border-gray-700"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Y Coordinate</Label>
            <Input
              type="number"
              value={action.config.y || 0}
              onChange={(e) =>
                updateConfig("y", Number.parseInt(e.target.value))
              }
              className="bg-transparent border-gray-700"
            />
          </div>
        </>
      )}

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
