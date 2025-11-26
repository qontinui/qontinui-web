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

import { Suspense } from 'react'
import { StateStructure } from '@/components/state-machine'
import { RequireProject } from '@/components/require-project'
import { Loader2 } from 'lucide-react'

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-[#00D9FF]" />
    </div>
  )
}

export default function StatesPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <RequireProject pageName="States">
        <StateStructure />
      </RequireProject>
    </Suspense>
  )
}
