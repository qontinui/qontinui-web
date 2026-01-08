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
 * Helper to get the target type from config.
 * Handles both new object format and legacy string format.
 */
function getTargetType(config: Record<string, unknown>): string {
  const target = config.target;

  // New object format: { type: "lastFindResult" }
  if (target && typeof target === "object" && "type" in target) {
    return (target as { type: string }).type;
  }

  // Legacy string format: "Last Find Result", etc.
  if (typeof target === "string") {
    switch (target) {
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
 * Helper to get coordinates from target config.
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
 * Properties component for MOUSE_MOVE action.
 *
 * Generates target configs that match qontinui-schemas TargetConfig types:
 * - LastFindResultTarget: { type: "lastFindResult" }
 * - CoordinatesTarget: { type: "coordinates", coordinates: { x, y } }
 */
export function MouseMoveProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const targetType = getTargetType(action.config);
  const coords = getCoordinates(action.config);

  const handleTargetTypeChange = (value: string) => {
    // Clear legacy fields
    updateConfig("x", undefined);
    updateConfig("y", undefined);

    switch (value) {
      case "lastFindResult":
        updateConfig("target", { type: "lastFindResult" });
        break;
      case "coordinates":
        updateConfig("target", {
          type: "coordinates",
          coordinates: { x: 0, y: 0 },
        });
        break;
      default:
        updateConfig("target", { type: "lastFindResult" });
    }
  };

  const handleCoordinateChange = (axis: "x" | "y", value: number) => {
    const newCoords = { ...coords, [axis]: value };
    updateConfig("target", { type: "coordinates", coordinates: newCoords });
  };

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Target</Label>
        <Select value={targetType} onValueChange={handleTargetTypeChange}>
          <SelectTrigger className="bg-transparent border-border-default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-surface-raised border-border-default">
            <SelectItem value="lastFindResult">Last Find Result</SelectItem>
            <SelectItem value="coordinates">Coordinates</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {targetType === "coordinates" && (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">X Coordinate</Label>
            <Input
              type="number"
              value={coords.x}
              onChange={(e) =>
                handleCoordinateChange(
                  "x",
                  Number.parseInt(e.target.value) || 0
                )
              }
              className="bg-transparent border-border-default"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">Y Coordinate</Label>
            <Input
              type="number"
              value={coords.y}
              onChange={(e) =>
                handleCoordinateChange(
                  "y",
                  Number.parseInt(e.target.value) || 0
                )
              }
              className="bg-transparent border-border-default"
            />
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label className="text-xs text-text-muted">
          Movement Duration (ms)
        </Label>
        <Input
          type="number"
          min="0"
          value={(action.config.duration as number) || 0}
          onChange={(e) =>
            updateConfig("duration", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-border-default"
        />
        <p className="text-xs text-text-muted">
          0 = instant movement, &gt;0 = smooth animation
        </p>
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}

/**
 * Properties component for MOUSE_DOWN and MOUSE_UP actions.
 *
 * Generates target configs that match qontinui-schemas TargetConfig types:
 * - CurrentPositionTarget: { type: "currentPosition" }
 * - LastFindResultTarget: { type: "lastFindResult" }
 * - CoordinatesTarget: { type: "coordinates", coordinates: { x, y } }
 */
export function MouseButtonProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const targetType = getTargetType(action.config) || "currentPosition";
  const coords = getCoordinates(action.config);

  const handleTargetTypeChange = (value: string) => {
    // Clear legacy fields
    updateConfig("x", undefined);
    updateConfig("y", undefined);

    switch (value) {
      case "currentPosition":
        updateConfig("target", { type: "currentPosition" });
        break;
      case "lastFindResult":
        updateConfig("target", { type: "lastFindResult" });
        break;
      case "coordinates":
        updateConfig("target", {
          type: "coordinates",
          coordinates: { x: 0, y: 0 },
        });
        break;
      default:
        updateConfig("target", { type: "currentPosition" });
    }
  };

  const handleCoordinateChange = (axis: "x" | "y", value: number) => {
    const newCoords = { ...coords, [axis]: value };
    updateConfig("target", { type: "coordinates", coordinates: newCoords });
  };

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Button</Label>
        <Select
          value={(action.config.button as string) || "left"}
          onValueChange={(value) => updateConfig("button", value)}
        >
          <SelectTrigger className="bg-transparent border-border-default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-surface-raised border-border-default">
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="right">Right</SelectItem>
            <SelectItem value="middle">Middle</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Target (Optional)</Label>
        <Select value={targetType} onValueChange={handleTargetTypeChange}>
          <SelectTrigger className="bg-transparent border-border-default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-surface-raised border-border-default">
            <SelectItem value="currentPosition">Current Position</SelectItem>
            <SelectItem value="lastFindResult">Last Find Result</SelectItem>
            <SelectItem value="coordinates">Coordinates</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {targetType === "coordinates" && (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">X Coordinate</Label>
            <Input
              type="number"
              value={coords.x}
              onChange={(e) =>
                handleCoordinateChange(
                  "x",
                  Number.parseInt(e.target.value) || 0
                )
              }
              className="bg-transparent border-border-default"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">Y Coordinate</Label>
            <Input
              type="number"
              value={coords.y}
              onChange={(e) =>
                handleCoordinateChange(
                  "y",
                  Number.parseInt(e.target.value) || 0
                )
              }
              className="bg-transparent border-border-default"
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
 *
 * Generates target configs that match qontinui-schemas TargetConfig types:
 * - LastFindResultTarget: { type: "lastFindResult" }
 * - CoordinatesTarget: { type: "coordinates", coordinates: { x, y } }
 */
export function SimpleClickProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const targetType = getTargetType(action.config);
  const coords = getCoordinates(action.config);

  const handleTargetTypeChange = (value: string) => {
    // Clear legacy fields
    updateConfig("x", undefined);
    updateConfig("y", undefined);

    switch (value) {
      case "lastFindResult":
        updateConfig("target", { type: "lastFindResult" });
        break;
      case "coordinates":
        updateConfig("target", {
          type: "coordinates",
          coordinates: { x: 0, y: 0 },
        });
        break;
      default:
        updateConfig("target", { type: "lastFindResult" });
    }
  };

  const handleCoordinateChange = (axis: "x" | "y", value: number) => {
    const newCoords = { ...coords, [axis]: value };
    updateConfig("target", { type: "coordinates", coordinates: newCoords });
  };

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Target</Label>
        <Select value={targetType} onValueChange={handleTargetTypeChange}>
          <SelectTrigger className="bg-transparent border-border-default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-surface-raised border-border-default">
            <SelectItem value="lastFindResult">Last Find Result</SelectItem>
            <SelectItem value="coordinates">Coordinates</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {targetType === "coordinates" && (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">X Coordinate</Label>
            <Input
              type="number"
              value={coords.x}
              onChange={(e) =>
                handleCoordinateChange(
                  "x",
                  Number.parseInt(e.target.value) || 0
                )
              }
              className="bg-transparent border-border-default"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">Y Coordinate</Label>
            <Input
              type="number"
              value={coords.y}
              onChange={(e) =>
                handleCoordinateChange(
                  "y",
                  Number.parseInt(e.target.value) || 0
                )
              }
              className="bg-transparent border-border-default"
            />
          </div>
        </>
      )}

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
