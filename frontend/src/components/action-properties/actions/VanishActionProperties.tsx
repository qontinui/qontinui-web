"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageSelector } from "@/components/image-selector";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";
import type { VanishActionConfig } from "@/lib/action-schema/configs/find-actions";

/**
 * Properties component for VANISH action.
 * Uses the new target structure: {target: {type: "image", imageId: "..."}}
 */
export function VanishActionProperties({
  action,
  updateConfig,
  images,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as VanishActionConfig;

  // Extract imageId from the new target structure
  const imageId =
    config.target?.type === "image"
      ? (config.target as { imageId?: string }).imageId
      : null;

  const handleImageSelect = (selectedImageId: string | null) => {
    if (!selectedImageId) return;
    // Generate the new target structure
    updateConfig("target", {
      type: "image",
      imageId: selectedImageId,
    });
  };

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Image to Wait For</Label>
        {Boolean((action.config as Record<string, unknown>).removedImage) && (
          <div className="mb-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
            <span className="font-medium">Removed Image:</span>{" "}
            <span>
              {String((action.config as Record<string, unknown>).removedImage)}
            </span>
            <p className="text-xs text-red-400 mt-1">
              This image was deleted. Please select a new image.
            </p>
          </div>
        )}
        <ImageSelector
          selectedImage={imageId as string | null}
          onSelectImage={handleImageSelect}
          images={images}
          placeholder="Select image to wait for disappearance"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Timeout (ms)</Label>
        <Input
          type="number"
          min="0"
          value={config.maxWaitTime || 5000}
          onChange={(e) =>
            updateConfig("maxWaitTime", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-border-default"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Check Interval (ms)</Label>
        <Input
          type="number"
          min="0"
          value={config.pollInterval || 500}
          onChange={(e) =>
            updateConfig("pollInterval", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-border-default"
        />
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
