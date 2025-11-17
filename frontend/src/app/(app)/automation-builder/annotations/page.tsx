'use client'

/**
 * Screenshot Annotation Page
 *
 * Annotate screenshots to define regions, locations, and anchor points for state recognition.
 *
 * Allows users to:
 * - Draw regions on screenshots to define areas of interest
 * - Mark specific locations (points) for element detection
 * - Create anchor regions for relative positioning
 * - Associate annotations with states
 * - Configure region and location properties
 * - Save annotation data for pattern matching
 */

import { useAutomation } from '@/contexts/automation-context'
import ScreenshotAnnotationTab from '@/components/screenshot-annotation/ScreenshotAnnotationTab'

export default function AnnotationsPage() {
  const { states } = useAutomation()

  return <ScreenshotAnnotationTab states={states} />
}
