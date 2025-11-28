import { ImageAsset } from "@/contexts/automation-context/types";

/**
 * Utility functions for managing the Image Library
 */

/**
 * Converts a base64 data URL and metadata to an ImageAsset for the Image Library
 * @param imageData Base64 data URL of the image
 * @param name Name for the image asset
 * @param source Source of the image (pattern_optimization, image_extraction, or state_discovery)
 * @returns ImageAsset object ready to be added to the Image Library
 */
export function createImageAsset(
  imageData: string,
  name: string,
  source: "pattern_optimization" | "image_extraction" | "state_discovery"
): ImageAsset {
  // Calculate approximate size from base64 data
  // Base64 encoding increases size by ~33%, and we need to account for the data URL prefix
  const base64Data = imageData.split(",")[1] || "";
  const sizeInBytes = Math.ceil((base64Data.length * 3) / 4);

  return {
    id: `image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    url: imageData,
    size: sizeInBytes,
    createdAt: new Date(),
    usageCount: 0,
    usage: [],
    source,
  };
}

/**
 * Checks if an image with the same data already exists in the library
 * @param images Current image library
 * @param imageData Base64 data URL to check
 * @returns True if the image already exists, false otherwise
 */
export function imageExistsInLibrary(
  images: ImageAsset[],
  imageData: string
): boolean {
  return images.some((img) => img.url === imageData);
}

/**
 * Finds an existing image in the library by data
 * @param images Current image library
 * @param imageData Base64 data URL to find
 * @returns The matching ImageAsset or undefined if not found
 */
export function findImageByData(
  images: ImageAsset[],
  imageData: string
): ImageAsset | undefined {
  return images.find((img) => img.url === imageData);
}
