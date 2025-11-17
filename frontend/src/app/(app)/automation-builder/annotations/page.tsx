'use client'

/**
 * Screenshot Annotation Page (Admin Only - Local Use)
 *
 * Annotate screenshots to define regions, locations, and anchor points for state recognition.
 *
 * IMPORTANT: This is an admin-only feature intended for local development use only.
 * It should NOT be run on AWS due to high computational costs.
 *
 * Allows users to:
 * - Draw regions on screenshots to define areas of interest
 * - Mark specific locations (points) for element detection
 * - Create anchor regions for relative positioning
 * - Associate annotations with states
 * - Configure region and location properties
 * - Save annotation data for pattern matching
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/auth-context'
import { useAutomation } from '@/contexts/automation-context'
import { ScreenshotAnnotationTab } from '@/components/screenshot-annotation/ScreenshotAnnotationTab'
import { toast } from 'sonner'

export default function AnnotationsPage() {
  const { user, loading } = useAuth()
  const { states } = useAutomation()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user?.is_superuser) {
      toast.error('Admin access required')
      router.push('/dashboard')
    }
  }, [user, loading, router])

  if (!user?.is_superuser) {
    return null
  }

  return <ScreenshotAnnotationTab states={states} />
}
