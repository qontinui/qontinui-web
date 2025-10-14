"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ImageSelector } from "@/components/image-selector"
import { ActionPropertiesComponentProps } from "../types"
import { TimingProperties } from "../TimingProperties"

/**
 * Properties component for VANISH action.
 */
export function VanishActionProperties({
  action,
  updateConfig,
  images
}: ActionPropertiesComponentProps) {
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
          selectedImage={action.config.image || null}
          onSelectImage={(imageId) => updateConfig("image", imageId)}
          images={images}
          placeholder="Select image to wait for disappearance"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Timeout (ms)</Label>
        <Input
          type="number"
          min="0"
          value={action.config.timeout}
          onChange={(e) => updateConfig("timeout", Number.parseInt(e.target.value))}
          className="bg-transparent border-gray-700"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Check Interval (ms)</Label>
        <Input
          type="number"
          min="0"
          value={action.config.check_interval}
          onChange={(e) => updateConfig("check_interval", Number.parseInt(e.target.value))}
          className="bg-transparent border-gray-700"
        />
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  )
}
