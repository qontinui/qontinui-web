'use client'

import { useProjects } from '@/hooks/use-projects'
import { useAutomation } from '@/contexts/automation-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FolderOpen, Plus, Loader2, MousePointerClick } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

interface RequireProjectProps {
  children: React.ReactNode
  /** Page name to show in the message (e.g., "Workflows", "States") */
  pageName?: string
}

/**
 * Wrapper component that shows appropriate messages when:
 * 1. User has no projects - shows "create first project" message
 * 2. User has projects but none selected - shows "select a project" message
 * 3. User has a project selected (via context or URL param) - renders the children
 *
 * Styled to match the dashboard's empty state design.
 */
export function RequireProject({ children, pageName = 'this page' }: RequireProjectProps) {
  const { data: projects, isLoading, error } = useProjects()
  const { projectId } = useAutomation()
  const searchParams = useSearchParams()

  // Check for project ID in URL (used when navigating from dashboard)
  // searchParams can be null during SSR, so handle that case
  const urlProjectId = searchParams?.get('project') ?? null

  // Consider project selected if either context has it OR URL has it
  const hasProjectSelected = Boolean(projectId || urlProjectId)

  // Debug logging
  console.log('[RequireProject] isLoading:', isLoading, 'projects:', projects?.length, 'projectId:', projectId, 'urlProjectId:', urlProjectId, 'hasProjectSelected:', hasProjectSelected, 'error:', error?.message)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-[#00D9FF]" />
      </div>
    )
  }

  if (error) {
    // If there's an error (including auth errors), treat it as "no projects"
    // This handles the case where the user isn't logged in or their session expired
    console.log('[RequireProject] Error state, showing no-projects message:', error.message)
    return (
      <div className="flex items-center justify-center min-h-[400px] p-4">
        <Card className="bg-[#1A1A1B]/30 border-gray-800/50 border-dashed backdrop-blur-sm max-w-md">
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 bg-[#00D9FF]/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="w-8 h-8 text-[#00D9FF]" />
            </div>
            <h4 className="text-xl font-semibold mb-2 text-gray-300">No projects yet</h4>
            <p className="text-gray-500 mb-6">
              Create your first project to access {pageName}
            </p>
            <Button asChild className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium">
              <Link href="/dashboard">
                <Plus className="w-4 h-4 mr-2" />
                Create First Project
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // No projects exist - show "create first project" message
  if (!projects || projects.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-4">
        <Card className="bg-[#1A1A1B]/30 border-gray-800/50 border-dashed backdrop-blur-sm max-w-md">
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 bg-[#00D9FF]/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="w-8 h-8 text-[#00D9FF]" />
            </div>
            <h4 className="text-xl font-semibold mb-2 text-gray-300">No projects yet</h4>
            <p className="text-gray-500 mb-6">
              Create your first project to access {pageName}
            </p>
            <Button asChild className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium">
              <Link href="/dashboard">
                <Plus className="w-4 h-4 mr-2" />
                Create First Project
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Projects exist but none selected - show "select a project" message
  if (!hasProjectSelected) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-4">
        <Card className="bg-[#1A1A1B]/30 border-gray-800/50 border-dashed backdrop-blur-sm max-w-md">
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 bg-[#00D9FF]/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <MousePointerClick className="w-8 h-8 text-[#00D9FF]" />
            </div>
            <h4 className="text-xl font-semibold mb-2 text-gray-300">No project selected</h4>
            <p className="text-gray-500 mb-6">
              Select or create a project from the dashboard to access {pageName}
            </p>
            <Button asChild className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium">
              <Link href="/dashboard">
                <FolderOpen className="w-4 h-4 mr-2" />
                Go to Dashboard
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <>{children}</>
}
