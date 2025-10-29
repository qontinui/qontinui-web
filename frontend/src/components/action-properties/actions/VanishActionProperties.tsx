"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ImageSelector } from "@/components/image-selector"
import { ActionPropertiesComponentProps } from "../types"
import { TimingProperties } from "../TimingProperties"

/**
 * Properties component for VANISH action.
 * Uses the new target structure: {target: {type: "image", imageId: "..."}}
 */
export function VanishActionProperties({
  action,
  updateConfig,
  images
}: ActionPropertiesComponentProps) {
  // Extract imageId from the new target structure
  const imageId = action.config.target?.type === 'image'
    ? action.config.target.imageId
    : null

  const handleImageSelect = (selectedImageId: string) => {
    // Generate the new target structure
    updateConfig("target", {
      type: "image",
      imageId: selectedImageId
    })
  }

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Image to Wait For</Label>
        {action.config.removedImage && (
          <div className="mb-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
            <span className="font-medium">Removed Image:</span> {action.config.removedImage}
            <p className="text-xs text-red-400 mt-1">
              This image was deleted. Please select a new image.
            </p>
          </div>
        )}
        <ImageSelector
          selectedImage={imageId}
          onSelectImage={handleImageSelect}
          images={images}
          placeholder="Select image to wait for disappearance"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Timeout (ms)</Label>
        <Input
          type="number"
          min="0"
          value={action.config.maxWaitTime || 5000}
          onChange={(e) => updateConfig("maxWaitTime", Number.parseInt(e.target.value))}
          className="bg-transparent border-gray-700"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Check Interval (ms)</Label>
        <Input
          type="number"
          min="0"
          value={action.config.pollInterval || 500}
          onChange={(e) => updateConfig("pollInterval", Number.parseInt(e.target.value))}
          className="bg-transparent border-gray-700"
        />
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  )
}
