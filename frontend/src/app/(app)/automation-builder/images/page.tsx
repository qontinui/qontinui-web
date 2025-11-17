'use client'

/**
 * Images Library Page
 *
 * Central image repository for managing all images used in automation workflows.
 * Allows users to:
 * - Browse and organize project images
 * - Upload new images
 * - Edit images (crop, resize, adjust)
 * - Tag and categorize images
 * - View image metadata and usage
 * - Delete unused images
 * - Associate images with states and patterns
 */

import { ImagesManager } from '@/components/images-manager'

export default function ImagesPage() {
  return <ImagesManager />
}
