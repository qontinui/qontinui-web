'use client'

/**
 * State Structure Page
 *
 * Visual editor for creating and managing state structures in automation workflows.
 * Allows users to:
 * - Define states with associated images, regions, locations, and strings
 * - Create transitions between states
 * - Configure state properties (wait times, activation conditions)
 * - Auto-layout state graphs
 * - Associate GUI elements with states for recognition
 */

import { StateStructure } from '@/components/state-machine'

export default function StatesPage() {
  return <StateStructure />
}
