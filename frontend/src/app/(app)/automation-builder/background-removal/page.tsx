'use client'

/**
 * Background Removal Page (Experimental)
 *
 * Remove backgrounds from images to improve pattern matching accuracy.
 * Allows users to:
 * - Remove backgrounds from UI element images
 * - Isolate foreground elements for cleaner matching
 * - Configure background removal sensitivity
 * - Process images in batch
 * - Preview before/after comparisons
 * - Save processed images to the library
 * - Improve pattern matching by reducing noise
 *
 * Note: This feature is experimental and may require manual refinement.
 */

import { BackgroundRemovalTab } from '@/components/background-removal/BackgroundRemovalTab'

export default function BackgroundRemovalPage() {
  return <BackgroundRemovalTab />
}
