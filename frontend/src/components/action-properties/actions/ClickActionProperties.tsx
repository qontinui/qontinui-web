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
import { ImageSelector } from "@/components/image-selector";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";

/**
 * Properties component for CLICK action.
 */
export function ClickActionProperties({
  action,
  updateConfig,
  images,
  states,
}: ActionPropertiesComponentProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Target</Label>
        <Select
          value={action.config.target || "Last Find Result"}
          onValueChange={(value) => updateConfig("target", value)}
        >
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

      {action.config.target === "StateImage" && (
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">
            Select State and Images
          </Label>
          <div className="text-xs text-gray-500 mb-2">
            This will FIND the selected image(s) and CLICK the last one found.
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">State</Label>
            <Select
              value={action.config.stateId || ""}
              onValueChange={(value) => {
                updateConfig("stateId", value);
                // Clear image selection when state changes
                updateConfig("imageIds", []);
              }}
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
          </div>
          {action.config.stateId && (
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">
                Images from State (optional)
              </Label>
              <div className="text-xs text-gray-500 mb-2">
                If no images selected, will find any image from the state.
              </div>
              <ImageSelector
                selectedImages={action.config.imageIds || []}
                onSelectImages={(imageIds) =>
                  updateConfig("imageIds", imageIds)
                }
                multiSelect={true}
                images={images}
                states={states}
                placeholder="Select specific images (optional)"
                showStateFilter={false}
                filterByState={action.config.stateId}
              />
            </div>
          )}
        </div>
      )}

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
        <Label className="text-xs text-gray-400">Mouse Button</Label>
        <Select
          value={action.config.mouseButton}
          onValueChange={(value) => updateConfig("mouseButton", value)}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            <SelectItem value="LEFT">Left Click</SelectItem>
            <SelectItem value="RIGHT">Right Click</SelectItem>
            <SelectItem value="MIDDLE">Middle Click</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Number of Clicks</Label>
        <Input
          type="number"
          min="1"
          value={action.config.numberOfClicks}
          onChange={(e) =>
            updateConfig("numberOfClicks", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-gray-700"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Hold Duration (ms)</Label>
        <Input
          type="number"
          min="0"
          value={action.config.hold_duration}
          onChange={(e) =>
            updateConfig("hold_duration", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-gray-700"
        />
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
