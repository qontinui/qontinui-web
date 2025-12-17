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
import { ImageSelector } from "@/components/image-selector";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";

/**
 * Properties component for DRAG action.
 */
export function DragActionProperties({
  action,
  updateConfig,
  images,
  onUpdateAction,
}: ActionPropertiesComponentProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">From</Label>
        <Select
          value={(action.config.from as string)}
          onValueChange={(value) => updateConfig("from", value)}
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

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">To (Image)</Label>
        {action.config.removedImageTo && (
          <div className="mb-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
            <span className="font-medium">Removed Image:</span>{" "}
            {action.config.removedImageTo}
            <p className="text-xs text-red-400 mt-1">
              This image was deleted. Please select a new target image.
            </p>
          </div>
        )}
        <ImageSelector
          selectedImage={action.config.to || null}
          onSelectImage={(imageId) => {
            updateConfig("to", imageId);
            // Clear the removedImageTo marker when selecting a new image
            if (action.config.removedImageTo && onUpdateAction) {
              const updatedAction = {
                ...action,
                config: {
                  ...action.config,
                  to: imageId,
                  removedImageTo: undefined,
                },
              };
              onUpdateAction(updatedAction);
            }
          }}
          images={images}
          placeholder="Select target image"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Drag Duration (ms)</Label>
        <Input
          type="number"
          min="0"
          value={action.config.drag_duration}
          onChange={(e) =>
            updateConfig("drag_duration", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-gray-700"
        />
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="smooth_movement"
          checked={(action.config.smooth_movement as boolean)}
          onCheckedChange={(checked) =>
            updateConfig("smooth_movement", checked)
          }
        />
        <Label htmlFor="smooth_movement" className="text-xs text-gray-400">
          Smooth movement
        </Label>
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
