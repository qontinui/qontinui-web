"use client"

import { Label } from "@/components/ui/label"
import { ImageSelector } from "@/components/image-selector"
import { ActionPropertiesComponentProps } from "../types"
import { TimingProperties } from "../TimingProperties"
import { SimilarityThresholdOverride } from "../SimilarityThresholdOverride"
import { SearchStrategyOverride } from "../SearchStrategyOverride"

/**
 * Properties component for FIND action.
 */
export function FindActionProperties({
  action,
  updateConfig,
  images,
  states,
  shouldOpenImageSelector
}: ActionPropertiesComponentProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Image</Label>
        {action.config.removedImage && (
          <div className="mb-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
            <span className="font-medium">Removed Image:</span> {action.config.removedImage}
            <p className="text-xs text-red-400 mt-1">
              This image was deleted. Please select a new image.
            </p>
          </div>
        )}
        <ImageSelector
          selectedImage={action.config.image || null}
          onSelectImage={(imageId) => updateConfig("image", imageId)}
          images={images}
          states={states}
          placeholder="Select image to find"
          showStateFilter={true}
          initialOpen={shouldOpenImageSelector}
        />
      </div>

      <SimilarityThresholdOverride action={action} updateConfig={updateConfig} />
      <SearchStrategyOverride action={action} updateConfig={updateConfig} />
      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  )
}
