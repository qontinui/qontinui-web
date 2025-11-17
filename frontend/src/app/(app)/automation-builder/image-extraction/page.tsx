'use client'

/**
 * Image Extraction Page
 *
 * Extract and process images from screenshots for use in automation workflows.
 * Allows users to:
 * - Extract sub-images from larger screenshots
 * - Automatically detect UI elements and buttons
 * - Batch process multiple screenshots
 * - Configure extraction parameters (size, quality, format)
 * - Save extracted images to the image library
 * - Preview and validate extracted images
 * - Generate patterns from extracted elements
 */

import { ImageExtractionTab } from '@/components/image-extraction/ImageExtractionTab'

export default function ImageExtractionPage() {
  return <ImageExtractionTab />
}
