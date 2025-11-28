"use client";

import { Label } from "@/components/ui/label";
import { ImageSelector } from "@/components/image-selector";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";
import { SimilarityThresholdOverride } from "../SimilarityThresholdOverride";
import { SearchStrategyOverride } from "../SearchStrategyOverride";
import { DurationOverride } from "../DurationOverride";

/**
 * Properties component for FIND action.
 * Supports multi-image selection with new target structure:
 * {target: {type: "image", imageIds: ["id1", "id2", ...]}}
 */
export function FindActionProperties({
  action,
  updateConfig,
  images,
  states,
  shouldOpenImageSelector,
}: ActionPropertiesComponentProps) {
  // Extract imageIds from the new target structure (array format)
  const imageIds =
    action.config.target?.type === "image"
      ? action.config.target.imageIds
      : null;

  // Handle single image IDs for backward compatibility (shouldn't happen with new schema)
  const hasImageIds = imageIds && Array.isArray(imageIds);

  const handleImagesSelect = (selectedImageIds: string[]) => {
    // Generate the new target structure with array of image IDs
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
        {action.config.removedImage && (
          <div className="mb-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
            <span className="font-medium">Removed Image:</span>{" "}
            {action.config.removedImage}
            <p className="text-xs text-red-400 mt-1">
              This image was deleted. Please select new images.
            </p>
          </div>
        )}
        <ImageSelector
          selectedImages={hasImageIds ? imageIds : []}
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
