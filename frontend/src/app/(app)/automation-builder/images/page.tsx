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

import { Suspense } from 'react'
import { ImagesManager } from '@/components/images-manager'
import { RequireProject } from '@/components/require-project'
import { Loader2 } from 'lucide-react'

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-[#00D9FF]" />
    </div>
  )
}

export default function ImagesPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <RequireProject pageName="Images">
        <ImagesManager />
      </RequireProject>
    </Suspense>
  )
}
