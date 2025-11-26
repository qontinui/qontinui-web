'use client'

/**
 * Pattern Tests Page
 *
 * Test pattern matching by selecting an image and screenshot,
 * then running the qontinui library's find action.
 */

import { PatternMatchingTest } from '@/components/PatternMatching/PatternMatchingTest'
import { useAutomation } from '@/contexts/automation-context'
import { RequireProject } from '@/components/require-project'

export default function PatternTestsPage() {
  const { screenshots } = useAutomation()

  return (
    <RequireProject pageName="Pattern Tests">
      <PatternMatchingTest screenshots={screenshots} />
    </RequireProject>
  )
}
