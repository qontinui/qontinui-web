/**
 * useProjectLoader Hook
 *
 * Single Responsibility: Handle loading projects from backend based on URL parameters.
 * This hook extracts the project loading logic from the automation-builder component.
 *
 * Responsibilities:
 * - Extract project ID from URL search params
 * - Fetch project data from backend API
 * - Trigger context's loadConfiguration
 * - Track loading state
 * - Handle errors
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { projectService } from '@/services/service-factory'
import { useAutomation } from '@/contexts/automation-context'
import { projectLogger } from '@/lib/project-logger'
import { toast } from 'sonner'

interface UseProjectLoaderResult {
  /** Current project ID from backend (can be UUID string or numeric string) */
  projectId: string | null
  /** Project ID from URL (string) */
  projectIdFromUrl: string | null
  /** Whether a project is currently being loaded */
  isLoading: boolean
  /** Last error that occurred during loading */
  error: string | null
  /** Manually trigger a reload of the current project */
  reloadProject: () => Promise<void>
}

export function useProjectLoader(): UseProjectLoaderResult {
  const searchParams = useSearchParams()
  const [projectId, setProjectId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track which project ID we've already loaded to prevent duplicate loads
  const loadedProjectIdRef = useRef<string | null>(null)
  // Track if a load is in progress to prevent concurrent loads
  const loadingRef = useRef(false)

  const {
    loadConfiguration,
    setProjectName,
    setProjectId: setContextProjectId,
    setIsLoadingFromBackend,
  } = useAutomation()

  // Extract project ID from URL as primitive value
  const projectIdFromUrl = searchParams?.get('project') || null

  projectLogger.urlHandler('Extracted project ID from URL', {
    projectIdFromUrl,
    currentLoadedId: loadedProjectIdRef.current,
    isLoading: loadingRef.current,
  })

  // Core loading function
  const loadProject = useCallback(async (urlProjectId: string) => {
    // Debug: Log exactly what we received
    projectLogger.debug('ProjectLoader', 'loadProject called', {
      urlProjectId,
      type: typeof urlProjectId,
      length: urlProjectId?.length,
      trimmed: urlProjectId?.trim(),
      isFalsy: !urlProjectId,
      isEmptyAfterTrim: urlProjectId?.trim() === '',
    })

    // Validate input - project IDs can be UUIDs or numeric strings
    // Accept any non-empty string
    if (!urlProjectId || (typeof urlProjectId === 'string' && urlProjectId.trim() === '')) {
      projectLogger.warn('ProjectLoader', 'Invalid project ID - empty or falsy', { urlProjectId })
      return
    }

    // Prevent duplicate loads
    if (loadedProjectIdRef.current === urlProjectId) {
      projectLogger.debug('ProjectLoader', 'Project already loaded, skipping', {
        urlProjectId,
        loadedId: loadedProjectIdRef.current,
      })
      return
    }

    // Prevent concurrent loads
    if (loadingRef.current) {
      projectLogger.warn('ProjectLoader', 'Load already in progress, skipping', {
        urlProjectId,
        loadedId: loadedProjectIdRef.current,
      })
      return
    }

    projectLogger.projectLoader('Starting project load', {
      urlProjectId,
      previousLoadedId: loadedProjectIdRef.current,
    })

    loadingRef.current = true
    setIsLoading(true)
    setError(null)

    try {
      // Signal to context that we're loading from backend
      // This prevents the context's useEffect from overwriting our data
      setIsLoadingFromBackend(true)

      projectLogger.projectLoader('Fetching project from backend', { urlProjectId })

      // Pass project ID as string - backend accepts both UUID and numeric IDs
      const project = await projectService.getProject(urlProjectId)

      projectLogger.projectLoader('Received project from backend', {
        projectId: project.id,
        projectName: project.name,
        hasConfiguration: !!project.configuration,
        workflowCount: project.configuration?.workflows?.length ?? 0,
        stateCount: project.configuration?.states?.length ?? 0,
      })

      // Load configuration into context
      projectLogger.configLoader('Calling loadConfiguration', {
        projectName: project.name,
      })

      await loadConfiguration(project.configuration)

      projectLogger.configLoader('loadConfiguration completed', {
        projectName: project.name,
      })

      // Update project metadata
      setProjectName(project.name)
      setProjectId(project.id)
      setContextProjectId(project.id)

      // Mark as successfully loaded
      loadedProjectIdRef.current = urlProjectId

      projectLogger.projectLoader('Project load completed successfully', {
        projectId: project.id,
        projectName: project.name,
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load project'
      projectLogger.error('ProjectLoader', 'Failed to load project', {
        urlProjectId,
        error: errorMessage,
      })
      setError(errorMessage)
      toast.error('Failed to load project')
    } finally {
      loadingRef.current = false
      setIsLoading(false)
      // Clear the backend loading flag after a short delay to ensure state updates complete
      setTimeout(() => {
        setIsLoadingFromBackend(false)
        projectLogger.projectLoader('Backend loading flag cleared')
      }, 100)
    }
  }, [loadConfiguration, setProjectName, setContextProjectId, setIsLoadingFromBackend])

  // Effect to load project when URL changes
  useEffect(() => {
    projectLogger.urlHandler('URL project ID effect triggered', {
      projectIdFromUrl,
      loadedProjectIdRef: loadedProjectIdRef.current,
    })

    if (projectIdFromUrl) {
      loadProject(projectIdFromUrl)
    } else {
      // URL has no project ID - reset state
      projectLogger.urlHandler('No project ID in URL, resetting state')
      loadedProjectIdRef.current = null
      setProjectId(null)
      setContextProjectId(null)
    }
  }, [projectIdFromUrl, loadProject, setContextProjectId])

  // Manual reload function
  const reloadProject = useCallback(async () => {
    if (projectIdFromUrl) {
      // Clear the loaded ref to force reload
      loadedProjectIdRef.current = null
      await loadProject(projectIdFromUrl)
    }
  }, [projectIdFromUrl, loadProject])

  return {
    projectId,
    projectIdFromUrl,
    isLoading,
    error,
    reloadProject,
  }
}
