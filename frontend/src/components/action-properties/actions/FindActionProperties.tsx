"use client";

import { Label } from "@/components/ui/label";
import { ImageSelector } from "@/components/image-selector";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";
import { SimilarityThresholdOverride } from "../SimilarityThresholdOverride";
import { SearchStrategyOverride } from "../SearchStrategyOverride";
import { DurationOverride } from "../DurationOverride";
import type { FindActionConfig } from "@/lib/action-schema/configs/find-actions";

/**
 * Properties component for FIND action.
 * Supports two target types:
 * - "image": Multi-image selection with {target: {type: "image", imageIds: ["id1", "id2", ...]}}
 * - "stateImage": Find any image from a state with {target: {type: "stateImage", stateId: "...", imageIds: [...]}}
 */
export function FindActionProperties({
  action,
  updateConfig,
  images,
  states,
  shouldOpenImageSelector,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as FindActionConfig;
  const targetType = config.target?.type;

  // Handle stateImage target type (Find State) - convert to image target type with ImageSelector
  // This provides a consistent UI with state filtering capabilities
  if (targetType === "stateImage") {
    const currentImageIds = (config.target as { imageIds?: string[] })?.imageIds || [];

    const handleImagesSelect = (selectedImageIds: string[]) => {
      // Convert to standard image target type for consistency
      updateConfig("target", {
        type: "image",
        imageIds: selectedImageIds,
      });
    };

    return (
      <>
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">
            Images (use state filter to narrow down)
          </Label>
          <ImageSelector
            selectedImages={currentImageIds}
            onSelectImages={handleImagesSelect}
            multiSelect={true}
            images={images}
            states={states}
            placeholder="Select images to find"
            showStateFilter={true}
            initialOpen={shouldOpenImageSelector}
          />
        </div>

        <SimilarityThresholdOverride
          action={action}
          updateConfig={updateConfig}
        />
        <SearchStrategyOverride action={action} updateConfig={updateConfig} />
        <TimingProperties action={action} updateConfig={updateConfig} />
      </>
    );
  }

  // Default: Handle image target type
  const imageIds =
    config.target?.type === "image" ? (config.target as { imageIds?: string[] }).imageIds : null;

  const hasImageIds = imageIds && Array.isArray(imageIds);

  const handleImagesSelect = (selectedImageIds: string[]) => {
    updateConfig("target", {
      type: "image",
      imageIds: selectedImageIds,
    });
  };

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">
          Images (multi-select enabled)
        </Label>
        {(action.config as Record<string, unknown>).removedImage && (
          <div className="mb-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
            <span className="font-medium">Removed Image:</span>{" "}
            {(action.config as Record<string, unknown>).removedImage as string}
            <p className="text-xs text-red-400 mt-1">
              This image was deleted. Please select new images.
            </p>
          </div>
        )}
        <ImageSelector
          selectedImages={hasImageIds ? (imageIds as string[]) : []}
          onSelectImages={handleImagesSelect}
          multiSelect={true}
          images={images}
          states={states}
          placeholder="Select images to find"
          showStateFilter={true}
          initialOpen={shouldOpenImageSelector}
        />
      </div>

      <SimilarityThresholdOverride
        action={action}
        updateConfig={updateConfig}
      />
      <SearchStrategyOverride action={action} updateConfig={updateConfig} />
      <DurationOverride action={action} updateConfig={updateConfig} />
      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
