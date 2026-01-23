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
import type { ImageAsset } from "@/contexts/automation-context/types";

/**
 * Helper to get target type from config field (handles from/to targets).
 * Supports both new object format and legacy string format.
 */
function getTargetTypeForField(
  config: Record<string, unknown>,
  field: string
): string {
  const target = config[field];

  // New object format: { type: "lastFindResult" }
  if (target && typeof target === "object" && "type" in target) {
    return (target as { type: string }).type;
  }

  // Legacy string format: "Last Find Result", etc.
  if (typeof target === "string") {
    switch (target) {
      case "Last Find Result":
        return "lastFindResult";
      case "Coordinates":
        return "coordinates";
      default:
        return "lastFindResult";
    }
  }

  return "lastFindResult";
}

/**
 * Helper to get image ID from "to" target config.
 */
function getToImageId(config: Record<string, unknown>): string | null {
  const to = config.to;

  // New format: { type: "image", imageIds: [...] }
  if (to && typeof to === "object" && "imageIds" in to) {
    const imageIds = (to as { imageIds: string[] }).imageIds;
    return imageIds?.[0] || null;
  }

  // Legacy format: "to" is a string image ID
  if (typeof to === "string") {
    return to;
  }

  return null;
}

/**
 * Properties component for DRAG action.
 *
 * Generates target configs that match qontinui-schemas TargetConfig types:
 * - from: LastFindResultTarget | CoordinatesTarget
 * - to: ImageTarget (with imageIds array)
 */
export function DragActionProperties({
  action,
  updateConfig,
  images,
  onUpdateAction,
}: ActionPropertiesComponentProps) {
  const fromType = getTargetTypeForField(action.config, "from");
  const toImageId = getToImageId(action.config);

  const handleFromTypeChange = (value: string) => {
    switch (value) {
      case "lastFindResult":
        updateConfig("from", { type: "lastFindResult" });
        break;
      case "coordinates":
        updateConfig("from", {
          type: "coordinates",
          coordinates: { x: 0, y: 0 },
        });
        break;
      default:
        updateConfig("from", { type: "lastFindResult" });
    }
  };

  const handleToImageChange = (imageId: string | null) => {
    if (imageId) {
      updateConfig("to", { type: "image", imageIds: [imageId] });
    } else {
      updateConfig("to", null);
    }
    // Clear the removedImageTo marker when selecting a new image
    if (action.config.removedImageTo && onUpdateAction) {
      const updatedAction = {
        ...action,
        config: {
          ...action.config,
          to: imageId ? { type: "image", imageIds: [imageId] } : null,
          removedImageTo: undefined,
        },
      };
      onUpdateAction(updatedAction);
    }
  };

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">From</Label>
        <Select value={fromType} onValueChange={handleFromTypeChange}>
          <SelectTrigger className="bg-transparent border-border-default" data-ui-id="action-props-drag-from-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-surface-raised border-border-default">
            <SelectItem value="lastFindResult">Last Find Result</SelectItem>
            <SelectItem value="coordinates">Coordinates</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-text-muted">To (Image)</Label>
        {Boolean(action.config.removedImageTo) && (
          <div className="mb-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
            <span className="font-medium">Removed Image:</span>{" "}
            {String(action.config.removedImageTo)}
            <p className="text-xs text-red-400 mt-1">
              This image was deleted. Please select a new target image.
            </p>
          </div>
        )}
        <ImageSelector
          selectedImage={toImageId}
          onSelectImage={handleToImageChange}
          images={images as ImageAsset[]}
          placeholder="Select target image"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Drag Duration (ms)</Label>
        <Input
          type="number"
          min="0"
          value={(action.config.drag_duration as number) || 0}
          onChange={(e) =>
            updateConfig("drag_duration", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-border-default"
          data-ui-id="action-props-drag-duration-input"
        />
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="smooth_movement"
          checked={action.config.smooth_movement as boolean}
          onCheckedChange={(checked) =>
            updateConfig("smooth_movement", checked)
          }
          data-ui-id="action-props-drag-smooth-checkbox"
        />
        <Label htmlFor="smooth_movement" className="text-xs text-text-muted">
          Smooth movement
        </Label>
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
