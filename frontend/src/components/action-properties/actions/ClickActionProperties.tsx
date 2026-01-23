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
import type { ImageAsset, State } from "@/contexts/automation-context/types";

/**
 * Helper to get the target type from the config.
 * Handles both new object format and legacy string format.
 */
function getTargetType(config: Record<string, unknown>): string {
  const target = config.target;

  // New object format: { type: "image", imageIds: [...] }
  if (target && typeof target === "object" && "type" in target) {
    const targetType = (target as { type: string }).type;
    // Map backend types to UI selection values
    switch (targetType) {
      case "lastFindResult":
        return "lastFindResult";
      case "currentPosition":
        return "currentPosition";
      case "coordinates":
        return "coordinates";
      case "image":
        return "image";
      default:
        return "lastFindResult";
    }
  }

  // Legacy string format: "StateImage", "Last Find Result", etc.
  // Note: "StateImage" is @deprecated - use "stateImage" (lowercase) instead
  if (typeof target === "string") {
    switch (target) {
      case "StateImage": // @deprecated - legacy uppercase format
      case "stateImage": // preferred format
        return "image";
      case "Last Find Result":
        return "lastFindResult";
      case "Current Position":
        return "currentPosition";
      case "Coordinates":
        return "coordinates";
      default:
        return "lastFindResult";
    }
  }

  return "lastFindResult";
}

/**
 * Helper to get imageIds from target config.
 * Handles both new object format and legacy format.
 */
function getImageIds(config: Record<string, unknown>): string[] {
  const target = config.target;

  // New format: imageIds inside target object
  if (target && typeof target === "object" && "imageIds" in target) {
    return (target as { imageIds: string[] }).imageIds || [];
  }

  // Legacy format: imageIds at config root level
  if (Array.isArray(config.imageIds)) {
    return config.imageIds as string[];
  }

  return [];
}

/**
 * Helper to get coordinates from target config.
 * Handles both new object format and legacy format.
 */
function getCoordinates(config: Record<string, unknown>): {
  x: number;
  y: number;
} {
  const target = config.target;

  // New format: coordinates inside target object
  if (target && typeof target === "object" && "coordinates" in target) {
    const coords = (target as { coordinates: { x: number; y: number } })
      .coordinates;
    return { x: coords?.x || 0, y: coords?.y || 0 };
  }

  // Legacy format: x, y at config root level
  return {
    x: (config.x as number) || 0,
    y: (config.y as number) || 0,
  };
}

/**
 * Properties component for CLICK action.
 *
 * Generates target configs that match qontinui-schemas TargetConfig types:
 * - ImageTarget: { type: "image", imageIds: string[] }
 * - LastFindResultTarget: { type: "lastFindResult" }
 * - CurrentPositionTarget: { type: "currentPosition" }
 * - CoordinatesTarget: { type: "coordinates", coordinates: { x, y } }
 */
export function ClickActionProperties({
  action,
  updateConfig,
  images,
  states,
}: ActionPropertiesComponentProps) {
  const targetType = getTargetType(action.config);
  const currentImageIds = getImageIds(action.config);
  const currentCoords = getCoordinates(action.config);

  const handleTargetTypeChange = (value: string) => {
    // Clear legacy fields when changing target type
    updateConfig("imageIds", undefined);
    updateConfig("x", undefined);
    updateConfig("y", undefined);

    // Set proper target object based on selection
    switch (value) {
      case "lastFindResult":
        updateConfig("target", { type: "lastFindResult" });
        break;
      case "currentPosition":
        updateConfig("target", { type: "currentPosition" });
        break;
      case "coordinates":
        updateConfig("target", {
          type: "coordinates",
          coordinates: { x: 0, y: 0 },
        });
        break;
      case "image":
        updateConfig("target", { type: "image", imageIds: [] });
        break;
      default:
        updateConfig("target", { type: "lastFindResult" });
    }
  };

  const handleImageIdsChange = (imageIds: string[]) => {
    updateConfig("target", { type: "image", imageIds });
  };

  const handleCoordinateChange = (axis: "x" | "y", value: number) => {
    const newCoords = { ...currentCoords, [axis]: value };
    updateConfig("target", {
      type: "coordinates",
      coordinates: newCoords,
    });
  };

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Target</Label>
        <Select value={targetType} onValueChange={handleTargetTypeChange}>
          <SelectTrigger className="bg-transparent border-border-default" data-ui-id="action-props-click-target-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-surface-raised border-border-default">
            <SelectItem value="lastFindResult">Last Find Result</SelectItem>
            <SelectItem value="currentPosition">Current Position</SelectItem>
            <SelectItem value="coordinates">Coordinates</SelectItem>
            <SelectItem value="image">Image</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {targetType === "image" && (
        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Select Images</Label>
          <div className="text-xs text-text-muted mb-2">
            This will FIND the selected image(s) and CLICK the best match found.
            Use the state filter to narrow down images.
          </div>
          <ImageSelector
            selectedImages={currentImageIds}
            onSelectImages={handleImageIdsChange}
            multiSelect={true}
            images={images as ImageAsset[]}
            states={states as State[]}
            placeholder="Select images to find and click"
            showStateFilter={true}
          />
        </div>
      )}

      {targetType === "coordinates" && (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">X Coordinate</Label>
            <Input
              type="number"
              value={currentCoords.x}
              onChange={(e) =>
                handleCoordinateChange(
                  "x",
                  Number.parseInt(e.target.value) || 0
                )
              }
              className="bg-transparent border-border-default"
              data-ui-id="action-props-click-x-input"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">Y Coordinate</Label>
            <Input
              type="number"
              value={currentCoords.y}
              onChange={(e) =>
                handleCoordinateChange(
                  "y",
                  Number.parseInt(e.target.value) || 0
                )
              }
              className="bg-transparent border-border-default"
              data-ui-id="action-props-click-y-input"
            />
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Mouse Button</Label>
        <Select
          value={action.config.mouseButton as string}
          onValueChange={(value) => updateConfig("mouseButton", value)}
        >
          <SelectTrigger className="bg-transparent border-border-default" data-ui-id="action-props-click-mousebutton-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-surface-raised border-border-default">
            <SelectItem value="LEFT">Left Click</SelectItem>
            <SelectItem value="RIGHT">Right Click</SelectItem>
            <SelectItem value="MIDDLE">Middle Click</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Number of Clicks</Label>
        <Input
          type="number"
          min="1"
          value={action.config.numberOfClicks as number}
          onChange={(e) =>
            updateConfig("numberOfClicks", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-border-default"
          data-ui-id="action-props-click-numclicks-input"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Hold Duration (ms)</Label>
        <Input
          type="number"
          min="0"
          value={action.config.hold_duration as number}
          onChange={(e) =>
            updateConfig("hold_duration", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-border-default"
          data-ui-id="action-props-click-holdduration-input"
        />
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
