"use client";

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
import { SimilarityThresholdOverride } from "../SimilarityThresholdOverride";
import { SearchStrategyOverride } from "../SearchStrategyOverride";
import { DurationOverride } from "../DurationOverride";

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
  const targetType = action.config.target?.type;

  // Handle stateImage target type (Find State)
  if (targetType === "stateImage") {
    const stateId = action.config.target?.stateId || "";

    const handleStateSelect = (selectedStateId: string) => {
      // Get all image IDs from the selected state
      const selectedState = states.find((s) => s.id === selectedStateId);
      const imageIds =
        selectedState?.stateImages?.map((si: unknown) => si.id) || [];

      updateConfig("target", {
        type: "stateImage",
        stateId: selectedStateId,
        imageIds,
      });
    };

    const selectedState = states.find((s) => s.id === stateId);

    return (
      <>
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">Select State</Label>
          <Select value={stateId} onValueChange={handleStateSelect}>
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
          {stateId && (
            <div className="text-xs text-gray-400 mt-2">
              {selectedState && selectedState.stateImages?.length > 0
                ? `Will find any of ${selectedState.stateImages.length} image${selectedState.stateImages.length > 1 ? "s" : ""} from ${selectedState.name}`
                : selectedState
                  ? `No images defined for ${selectedState.name}`
                  : "State not found"}
            </div>
          )}
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
    action.config.target?.type === "image"
      ? action.config.target.imageIds
      : null;

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
